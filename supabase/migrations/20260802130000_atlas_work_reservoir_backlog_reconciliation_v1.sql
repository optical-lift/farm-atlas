begin;

create table if not exists atlas.work_reservoir_decisions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  state text not null default 'open' check (state in ('open','resolved')),
  reason text not null,
  suggested_action text not null default 'review',
  resolved_action text,
  target_date date,
  resolution_note text,
  task_snapshot jsonb not null default '{}'::jsonb,
  created_by_membership_id uuid references atlas.farm_memberships(id),
  resolved_by_membership_id uuid references atlas.farm_memberships(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (task_id)
);

alter table atlas.work_reservoir_decisions enable row level security;
revoke all on table atlas.work_reservoir_decisions from public, anon, authenticated;
grant all on table atlas.work_reservoir_decisions to service_role;

update atlas.tasks t
set due_date = (t.metadata ->> 'sunday_guardrail_shifted_to')::date,
    metadata = t.metadata || jsonb_build_object(
      'reservoirReconciledAt', now(),
      'reservoirReconciliationReason', 'honor_sunday_guardrail_shift'
    ),
    updated_at = now()
where t.status in ('open','blocked')
  and t.metadata ->> 'sunday_guardrail_shifted_to' ~ '^\d{4}-\d{2}-\d{2}$'
  and t.due_date is distinct from (t.metadata ->> 'sunday_guardrail_shifted_to')::date;

update atlas.planned_work_occurrences occurrence
set planned_due_date = task.due_date,
    not_before_date = least(coalesce(occurrence.not_before_date, task.due_date), task.due_date),
    task_payload = occurrence.task_payload || jsonb_build_object('due_date', task.due_date),
    metadata = occurrence.metadata || jsonb_build_object(
      'reservoirReconciledAt', now(),
      'reservoirReconciliationReason', 'honor_sunday_guardrail_shift'
    ),
    updated_at = now()
from atlas.tasks task
where task.planned_occurrence_id = occurrence.id
  and task.status in ('open','blocked')
  and task.metadata ->> 'reservoirReconciliationReason' = 'honor_sunday_guardrail_shift';

with classification as (
  select
    t.id,
    case
      when t.metadata ? 'event_deadline'
        or t.metadata ? 'trial_billing_date'
        or t.metadata ? 'owner_schedule_override'
        or t.metadata ? 'sunday_reason'
        or lower(t.title) ~ '^(pay |cancel |owner — decide|owner \+ marshall — final handoff|ensure no cats|final clean)'
        then 'required'
      when t.metadata ? 'workflow_key'
        or t.metadata ? 'sequence_key'
        or t.metadata ? 'prerequisite_task_id'
        or t.metadata ? 'dependent_task_id'
        or t.metadata ? 'dependent_task_ids'
        or t.metadata ? 'dependency_downstream_occurrence_id'
        or t.metadata ? 'sequence_number'
        or t.metadata ? 'production_plan_id'
        then 'process_continuation'
      when t.metadata ? 'rhythm_state_id'
        or t.metadata ? 'repeat_rule'
        or t.metadata ? 'weekly_routine'
        or t.metadata ? 'monthly_routine'
        or lower(coalesce(t.metadata ->> 'clock_managed', 'false')) = 'true'
        then 'rhythm'
      when t.metadata ? 'schedule_guardrail' then 'required'
      else null
    end as new_lane
  from atlas.tasks t
  where t.status in ('open','blocked')
    and t.parent_task_id is null
    and t.work_lane = 'discretionary'
), promoted as (
  update atlas.tasks t
  set work_lane = c.new_lane,
      commitment_kind = case c.new_lane
        when 'required' then 'hard_date'
        when 'process_continuation' then 'dependency'
        when 'rhythm' then 'persistent'
        else t.commitment_kind
      end,
      metadata = t.metadata || jsonb_build_object(
        'work_lane', c.new_lane,
        'commitment_kind', case c.new_lane
          when 'required' then 'hard_date'
          when 'process_continuation' then 'dependency'
          when 'rhythm' then 'persistent'
          else t.commitment_kind
        end,
        'reservoirReclassifiedAt', now(),
        'reservoirReclassificationReason', 'backlog_reconciliation_v1'
      ),
      updated_at = now()
  from classification c
  where c.id = t.id
    and c.new_lane is not null
  returning t.planned_occurrence_id, t.work_lane, t.commitment_kind
)
update atlas.planned_work_occurrences occurrence
set work_lane = promoted.work_lane,
    commitment_kind = promoted.commitment_kind,
    metadata = occurrence.metadata || jsonb_build_object(
      'work_lane', promoted.work_lane,
      'commitment_kind', promoted.commitment_kind,
      'reservoirReclassifiedAt', now(),
      'reservoirReclassificationReason', 'backlog_reconciliation_v1'
    ),
    updated_at = now()
from promoted
where occurrence.id = promoted.planned_occurrence_id;

with review_candidates as (
  select t.*
  from atlas.tasks t
  where t.status in ('open','blocked')
    and t.parent_task_id is null
    and t.work_lane = 'discretionary'
    and t.due_date <= (now() at time zone 'America/Chicago')::date
    and not exists (select 1 from atlas.task_transitions transition where transition.task_id = t.id)
    and not exists (select 1 from atlas.task_outcome_events outcome where outcome.task_id = t.id)
), marked as (
  update atlas.tasks t
  set metadata = t.metadata || jsonb_build_object(
        'reservoirDecisionState', 'owner_review',
        'reservoirDecisionQueuedAt', now(),
        'reservoirDecisionReason', 'untouched_discretionary_due_or_overdue'
      ),
      updated_at = now()
  from review_candidates candidate
  where candidate.id = t.id
  returning t.*
)
insert into atlas.work_reservoir_decisions (
  farm_id,
  task_id,
  reason,
  suggested_action,
  task_snapshot
)
select
  marked.farm_id,
  marked.id,
  'Untouched discretionary work reached or passed its working date without human evidence.',
  'review',
  to_jsonb(marked)
from marked
on conflict (task_id) do update
set state = 'open',
    reason = excluded.reason,
    suggested_action = excluded.suggested_action,
    task_snapshot = excluded.task_snapshot,
    resolved_action = null,
    target_date = null,
    resolution_note = null,
    resolved_by_membership_id = null,
    resolved_at = null;

create or replace function atlas.resolve_work_reservoir_decision_v1(
  p_decision_id uuid,
  p_action text,
  p_target_date date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_decision atlas.work_reservoir_decisions%rowtype;
  v_task atlas.tasks%rowtype;
  v_membership_id uuid;
  v_occurrence_snapshot jsonb := null;
begin
  select * into v_decision
  from atlas.work_reservoir_decisions
  where id = p_decision_id
  for update;

  if v_decision.id is null or v_decision.state <> 'open' then
    raise exception 'Open reservoir decision not found.' using errcode = 'P0002';
  end if;

  if not atlas.is_farm_manager_or_owner(v_decision.farm_id) then
    raise exception 'Only farm management may resolve reservoir decisions.' using errcode = '42501';
  end if;

  if p_action not in ('keep_now','choose_date','return_to_reservoir','archive') then
    raise exception 'Unsupported reservoir decision action.' using errcode = '22023';
  end if;
  if p_action = 'choose_date' and p_target_date is null then
    raise exception 'choose_date requires a target date.' using errcode = '22023';
  end if;

  v_membership_id := atlas.current_membership_id(v_decision.farm_id);
  select * into v_task from atlas.tasks where id = v_decision.task_id for update;
  if v_task.id is null then
    raise exception 'Decision task not found.' using errcode = 'P0002';
  end if;

  if v_task.planned_occurrence_id is not null then
    select to_jsonb(occurrence) into v_occurrence_snapshot
    from atlas.planned_work_occurrences occurrence
    where occurrence.id = v_task.planned_occurrence_id;
  end if;

  if p_action = 'keep_now' then
    update atlas.tasks
    set metadata = (metadata - 'reservoirDecisionState' - 'reservoirDecisionQueuedAt' - 'reservoirDecisionReason')
        || jsonb_build_object('reservoirDecisionResolvedAt', now(), 'reservoirDecisionAction', p_action),
        updated_at = now()
    where id = v_task.id;

  elsif p_action = 'choose_date' then
    update atlas.tasks
    set due_date = p_target_date,
        metadata = (metadata - 'reservoirDecisionState' - 'reservoirDecisionQueuedAt' - 'reservoirDecisionReason')
          || jsonb_build_object(
            'reservoirDecisionResolvedAt', now(),
            'reservoirDecisionAction', p_action,
            'reservoirDecisionTargetDate', p_target_date
          ),
        updated_at = now()
    where id = v_task.id;

    update atlas.planned_work_occurrences
    set planned_due_date = p_target_date,
        not_before_date = p_target_date,
        task_payload = task_payload || jsonb_build_object('due_date', p_target_date),
        metadata = metadata || jsonb_build_object(
          'reservoirDecisionResolvedAt', now(),
          'reservoirDecisionAction', p_action,
          'reservoirDecisionTargetDate', p_target_date
        ),
        updated_at = now()
    where id = v_task.planned_occurrence_id;

  elsif p_action = 'return_to_reservoir' then
    if v_task.planned_occurrence_id is not null then
      insert into atlas.work_reservoir_retractions (
        farm_id, occurrence_id, retired_task_id, reason, snapshot
      ) values (
        v_task.farm_id,
        v_task.planned_occurrence_id,
        v_task.id,
        coalesce(nullif(btrim(p_note), ''), 'Owner returned untouched work to the reservoir.'),
        jsonb_build_object('task', to_jsonb(v_task), 'occurrence', v_occurrence_snapshot, 'decisionId', v_decision.id)
      );

      update atlas.planned_work_occurrences
      set state = 'planned',
          planned_due_date = coalesce(p_target_date, planned_due_date, v_task.due_date),
          not_before_date = coalesce(p_target_date, planned_due_date, v_task.due_date),
          released_at = null,
          released_task_id = null,
          metadata = metadata || jsonb_build_object(
            'returnedToReservoirAt', now(),
            'returnedToReservoirDecisionId', v_decision.id
          ),
          updated_at = now()
      where id = v_task.planned_occurrence_id;
    end if;

    update atlas.tasks
    set status = 'archived',
        metadata = (metadata - 'reservoirDecisionState' - 'reservoirDecisionQueuedAt' - 'reservoirDecisionReason')
          || jsonb_build_object('returnedToReservoirAt', now(), 'returnedToReservoirDecisionId', v_decision.id),
        updated_at = now()
    where id = v_task.id;

  elsif p_action = 'archive' then
    update atlas.planned_work_occurrences
    set state = 'cancelled',
        metadata = metadata || jsonb_build_object(
          'cancelledByReservoirDecisionAt', now(),
          'reservoirDecisionId', v_decision.id
        ),
        updated_at = now()
    where id = v_task.planned_occurrence_id
      and state not in ('completed','superseded');

    update atlas.tasks
    set status = 'archived',
        metadata = (metadata - 'reservoirDecisionState' - 'reservoirDecisionQueuedAt' - 'reservoirDecisionReason')
          || jsonb_build_object('archivedByReservoirDecisionAt', now(), 'reservoirDecisionId', v_decision.id),
        updated_at = now()
    where id = v_task.id;
  end if;

  update atlas.work_reservoir_decisions
  set state = 'resolved',
      resolved_action = p_action,
      target_date = p_target_date,
      resolution_note = nullif(btrim(p_note), ''),
      resolved_by_membership_id = v_membership_id,
      resolved_at = now()
  where id = v_decision.id;

  return jsonb_build_object(
    'ok', true,
    'decisionId', v_decision.id,
    'taskId', v_task.id,
    'action', p_action,
    'targetDate', p_target_date
  );
end;
$function$;

revoke execute on function atlas.resolve_work_reservoir_decision_v1(uuid, text, date, text) from public, anon;
grant execute on function atlas.resolve_work_reservoir_decision_v1(uuid, text, date, text) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, registered_at, reviewed_at
) values (
  'atlas.resolve_work_reservoir_decision_v1(uuid, text, date, text)', 'owner_admin_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','work_reservoir_backlog_reconciliation_v1','call_site','Tomorrow Preflight decision queue','authorization','owner or manager','reviewed_date','2026-08-02'), now(), now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;

commit;
