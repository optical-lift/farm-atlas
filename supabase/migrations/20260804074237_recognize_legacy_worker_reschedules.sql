-- Early assigned-task-page moves predated actor membership capture. Recognize
-- those transitions only when the task still belongs to the same worker.

create or replace function atlas.task_rescheduled_by_membership_v1(
  p_task_id uuid,
  p_membership_id uuid,
  p_worker_key text default null::text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select exists (
    select 1
    from atlas.task_transitions transition_row
    join atlas.tasks task on task.id = transition_row.task_id
    where transition_row.task_id = p_task_id
      and transition_row.transition = 'rescheduled'
      and (
        transition_row.actor_membership_id = p_membership_id
        or transition_row.payload ->> 'actor_membership_id' = p_membership_id::text
        or (
          transition_row.actor_membership_id is null
          and lower(coalesce(transition_row.reason, '')) like '%assigned task page%'
          and (
            task.assigned_membership_id = p_membership_id
            or task.metadata ->> 'executor_membership_id' = p_membership_id::text
            or (
              nullif(lower(btrim(coalesce(p_worker_key, ''))), '') is not null
              and lower(coalesce(transition_row.payload ->> 'assigneeKey', '')) = lower(btrim(p_worker_key))
            )
          )
        )
      )
  );
$function$;

revoke all on function atlas.task_rescheduled_by_membership_v1(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function atlas.task_rescheduled_by_membership_v1(uuid, uuid, text)
to service_role;

comment on function atlas.task_rescheduled_by_membership_v1(uuid, uuid, text) is
  'Internal resolver: recognizes membership-attributed and legacy assigned-task-page worker reschedules.';

-- Restore the two legacy moves whose actor identity was not yet captured. The
-- transition rows remain the historical evidence; no synthetic move is added.
with elm as (
  select id
  from atlas.farms
  where stable_key = 'elm_farm'
), anna as (
  select membership.id
  from atlas.farm_memberships membership
  join elm on elm.id = membership.farm_id
  where membership.active
    and lower(coalesce(membership.worker_key, '')) = 'anna'
  order by membership.created_at
  limit 1
), candidates as (
  select task.id, task.metadata
  from atlas.tasks task
  join elm on elm.id = task.farm_id
  join anna on anna.id = task.assigned_membership_id
  where task.status in ('open', 'blocked')
    and task.parent_task_id is null
    and (
      task.metadata ->> 'task_key' = 'anna_20260716_divide_lilac_haven_irises_into_drifts'
      or (
        task.metadata ->> 'task_key' = 'anna_20260713_mow_corral_weekly'
        and nullif(task.metadata ->> 'planned_occurrence_id', '') is not null
      )
    )
), worker_moves as (
  select distinct on (transition_row.task_id)
    transition_row.task_id,
    transition_row.target_date,
    jsonb_build_object(
      'note', transition_row.note,
      'reason', transition_row.reason,
      'action_key', transition_row.action_key,
      'transition', transition_row.transition,
      'work_class', transition_row.work_class,
      'recorded_at', transition_row.created_at,
      'target_date', transition_row.target_date,
      'idempotency_key', transition_row.idempotency_key
    ) as transition_snapshot
  from atlas.task_transitions transition_row
  join candidates on candidates.id = transition_row.task_id
  where transition_row.transition = 'rescheduled'
    and transition_row.target_date is not null
    and transition_row.actor_membership_id is null
    and lower(coalesce(transition_row.reason, '')) like '%assigned task page%'
  order by transition_row.task_id, transition_row.created_at desc
), repaired as (
  update atlas.tasks task
  set due_date = worker_moves.target_date,
      metadata = jsonb_set(
        (
          coalesce(task.metadata, '{}'::jsonb)
          - 'owner_rescheduled_at'
          - 'owner_rescheduled_from'
          - 'owner_rescheduled_to'
          - 'owner_rescheduled_reason'
          - 'owner_reschedule_reason'
          - 'sunday_guardrail_applied'
          - 'sunday_guardrail_original_due_date'
          - 'sunday_guardrail_shifted_to'
          - 'sunday_guardrail_applied_at'
          - 'sunday_guardrail_reason'
        ) || jsonb_build_object(
          'allow_sunday', case
            when extract(dow from worker_moves.target_date) = 0 then true
            else coalesce((task.metadata ->> 'allow_sunday')::boolean, false)
          end,
          'worker_schedule_restored_at', now(),
          'worker_schedule_restored_to', worker_moves.target_date::text,
          'worker_schedule_restored_reason', 'Restored from legacy assigned-worker reschedule history'
        ),
        '{last_transition}', worker_moves.transition_snapshot, true
      )
  from worker_moves
  where task.id = worker_moves.task_id
  returning task.id, task.due_date, task.metadata
)
update atlas.planned_work_occurrences occurrence
set planned_due_date = repaired.due_date,
    not_before_date = least(coalesce(occurrence.not_before_date, repaired.due_date), repaired.due_date),
    task_payload = jsonb_set(
      jsonb_set(coalesce(occurrence.task_payload, '{}'::jsonb), '{due_date}', to_jsonb(repaired.due_date::text), true),
      '{metadata}', repaired.metadata, true
    ),
    metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
      'worker_schedule_restored_at', now(),
      'worker_schedule_restored_to', repaired.due_date::text,
      'worker_schedule_restored_reason', 'Restored from legacy assigned-worker reschedule history'
    ),
    updated_at = now()
from repaired
where occurrence.released_task_id = repaired.id;
