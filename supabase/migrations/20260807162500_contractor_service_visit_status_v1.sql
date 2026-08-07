create or replace function atlas.record_contractor_service_visit_v1(
  p_task_id uuid,
  p_service_date date,
  p_effective_membership_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task atlas.tasks%rowtype;
  v_role text;
  v_provider_key text;
  v_provider_label text;
  v_cadence_days integer := 14;
  v_next_date date;
  v_transition jsonb;
  v_occ atlas.planned_work_occurrences%rowtype;
  v_next_occurrence_id uuid;
  v_next_payload jsonb;
  v_next_metadata jsonb;
  v_today date := (timezone('America/Chicago', now()))::date;
begin
  if p_service_date is null then
    raise exception using errcode = '22023', message = 'Service date is required.';
  end if;
  if p_service_date > v_today then
    raise exception using errcode = '22023', message = 'Service date cannot be in the future.';
  end if;

  select * into v_task
  from atlas.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Task not found.';
  end if;

  v_provider_key := nullif(v_task.metadata->>'provider_key', '');
  if v_task.task_type <> 'contractor_service_status' or v_provider_key is null then
    raise exception using errcode = '22023', message = 'This task is not a contractor service status card.';
  end if;

  select role into v_role
  from atlas.farm_memberships
  where id = p_effective_membership_id
    and farm_id = v_task.farm_id
    and active = true;

  if v_role is null then
    raise exception using errcode = '42501', message = 'No active farm membership is available.';
  end if;

  if p_effective_membership_id is distinct from v_task.assigned_membership_id
     and v_role not in ('owner', 'manager') then
    raise exception using errcode = '42501', message = 'This service card belongs to another worker.';
  end if;

  if v_task.status = 'done' and coalesce(v_task.metadata->>'visit_status', '') = 'yes' then
    if nullif(v_task.metadata->>'actual_service_date', '')::date is distinct from p_service_date then
      raise exception using errcode = '22023', message = 'This visit has already been confirmed with a different date.';
    end if;
    return jsonb_build_object(
      'ok', true,
      'taskId', v_task.id,
      'serviceDate', p_service_date,
      'nextDate', nullif(v_task.metadata->>'next_expected_service_date', '')::date,
      'alreadyConfirmed', true
    );
  end if;

  begin
    v_cadence_days := greatest(1, coalesce((v_task.metadata->>'cadence_days')::integer, 14));
  exception when others then
    v_cadence_days := 14;
  end;

  v_next_date := p_service_date + v_cadence_days;
  v_provider_label := coalesce(
    nullif(v_task.metadata->>'collection_label', ''),
    nullif(v_task.metadata->>'display_subject', ''),
    initcap(replace(v_provider_key, '_', ' '))
  );

  update atlas.tasks
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'task_style', 'contractor_service_status',
        'visit_status', 'yes',
        'service_confirmed', true,
        'actual_service_date', p_service_date::text,
        'actual_service_weekday', trim(to_char(p_service_date, 'Day')),
        'service_confirmed_at', now()::text,
        'next_expected_service_date', v_next_date::text,
        'preferred_weekday', trim(to_char(v_next_date, 'Day'))
      ),
      updated_at = now()
  where id = v_task.id;

  select atlas.record_task_transition_v1_internal(
    v_task.id,
    'done',
    'contractor-service:' || v_task.id::text || ':' || p_service_date::text,
    null,
    'Yes — ' || v_provider_label || ' came ' || to_char(p_service_date, 'FMDay, Mon FMDD') || '.',
    'Contractor service visit confirmed.',
    v_task.action_key,
    v_task.action_key,
    jsonb_build_object(
      'providerKey', v_provider_key,
      'serviceDate', p_service_date,
      'nextExpectedServiceDate', v_next_date
    ),
    null
  ) into v_transition;

  if v_task.planned_occurrence_id is not null then
    select * into v_occ
    from atlas.planned_work_occurrences
    where id = v_task.planned_occurrence_id;

    if found then
      update atlas.planned_work_occurrences
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'actual_service_date', p_service_date::text,
            'service_confirmed_at', now()::text
          ),
          updated_at = now()
      where id = v_occ.id;

      select id into v_next_occurrence_id
      from atlas.planned_work_occurrences
      where work_definition_id = v_occ.work_definition_id
        and occurrence_key = 'contractor_service:' || v_provider_key || ':' || v_next_date::text
      limit 1;

      if v_next_occurrence_id is null then
        v_next_metadata := (
          coalesce(v_occ.task_payload->'metadata', '{}'::jsonb)
          - 'planned_occurrence_id'
          - 'release_policy_id'
          - 'released_at'
          - 'execution_date'
          - 'reservoir_planned_due_date'
          - 'visit_status'
          - 'service_confirmed'
          - 'service_confirmed_at'
          - 'actual_service_date'
          - 'actual_service_weekday'
          - 'owner_confirmed_at'
          - 'last_transition'
          - 'transition_count'
        ) || jsonb_build_object(
          'task_style', 'contractor_service_status',
          'status_question', 'Did they come?',
          'task_key', v_provider_key || '_visit_status_' || to_char(v_next_date, 'YYYYMMDD'),
          'provider_key', v_provider_key,
          'cadence_days', v_cadence_days,
          'preferred_weekday', trim(to_char(v_next_date, 'Day')),
          'display_action', 'Did they come?',
          'display_subject', v_provider_label,
          'display_detail', coalesce('$' || nullif(v_task.metadata->>'price_per_visit', '') || ' ', '')
            || 'full-property mow · expected ' || to_char(v_next_date, 'FMDay, Mon FMDD'),
          'cadence_anchor_service_date', p_service_date::text,
          'next_task_policy', 'Create the next confirmation from the actual service date recorded on this card'
        );

        v_next_payload := coalesce(v_occ.task_payload, '{}'::jsonb)
          || jsonb_build_object(
            'status', 'open',
            'due_date', v_next_date::text,
            'completed_at', null,
            'completed_by', null,
            'metadata', v_next_metadata,
            'engine_instance_key', 'contractor_service:' || v_provider_key || ':' || v_next_date::text
          );

        insert into atlas.planned_work_occurrences (
          farm_id,
          work_definition_id,
          release_policy_id,
          parent_occurrence_id,
          occurrence_key,
          source_kind,
          source_event_key,
          title,
          planned_due_date,
          not_before_date,
          state,
          task_payload,
          relation_payload,
          metadata,
          work_lane,
          commitment_kind,
          effort_units
        ) values (
          v_occ.farm_id,
          v_occ.work_definition_id,
          v_occ.release_policy_id,
          v_occ.id,
          'contractor_service:' || v_provider_key || ':' || v_next_date::text,
          'contractor_service_cadence',
          v_provider_key || ':' || v_next_date::text,
          v_occ.title,
          v_next_date,
          v_next_date,
          'planned',
          v_next_payload,
          v_occ.relation_payload,
          jsonb_build_object(
            'provider_key', v_provider_key,
            'cadence_source_service_date', p_service_date::text,
            'cadence_days', v_cadence_days
          ),
          v_occ.work_lane,
          v_occ.commitment_kind,
          v_occ.effort_units
        ) returning id into v_next_occurrence_id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'taskId', v_task.id,
    'serviceDate', p_service_date,
    'nextDate', v_next_date,
    'nextOccurrenceId', v_next_occurrence_id,
    'transition', v_transition,
    'alreadyConfirmed', false
  );
end;
$$;

grant execute on function atlas.record_contractor_service_visit_v1(uuid, date, uuid) to authenticated, service_role;

-- Upgrade the existing Master Trimmers card and seed the next occurrence from the
-- actual Wednesday visit that was already recorded before this workflow existed.
update atlas.tasks
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'task_style', 'contractor_service_status',
      'status_question', 'Did they come?'
    ),
    updated_at = now()
where metadata->>'provider_key' = 'master_trimmers'
  and task_type = 'contractor_service_status';

with source as (
  select
    t.*,
    pwo.work_definition_id,
    pwo.release_policy_id as occurrence_release_policy_id,
    pwo.relation_payload,
    pwo.work_lane as occurrence_work_lane,
    pwo.commitment_kind as occurrence_commitment_kind,
    pwo.effort_units as occurrence_effort_units,
    pwo.id as source_occurrence_id,
    pwo.task_payload as source_payload,
    nullif(t.metadata->>'actual_service_date', '')::date as actual_service_date,
    greatest(1, coalesce(nullif(t.metadata->>'cadence_days','')::integer,14)) as cadence_days
  from atlas.tasks t
  join atlas.planned_work_occurrences pwo on pwo.id = t.planned_occurrence_id
  where t.metadata->>'provider_key' = 'master_trimmers'
    and t.task_type = 'contractor_service_status'
    and t.status = 'done'
    and nullif(t.metadata->>'actual_service_date', '') is not null
  order by t.completed_at desc nulls last, t.updated_at desc
  limit 1
), prepared as (
  select
    source.*,
    actual_service_date + cadence_days as next_date,
    (
      coalesce(source_payload->'metadata', '{}'::jsonb)
      - 'planned_occurrence_id'
      - 'release_policy_id'
      - 'released_at'
      - 'execution_date'
      - 'reservoir_planned_due_date'
      - 'visit_status'
      - 'service_confirmed'
      - 'service_confirmed_at'
      - 'actual_service_date'
      - 'actual_service_weekday'
      - 'owner_confirmed_at'
      - 'last_transition'
      - 'transition_count'
    ) || jsonb_build_object(
      'task_style', 'contractor_service_status',
      'status_question', 'Did they come?',
      'task_key', 'master_trimmers_visit_status_' || to_char(actual_service_date + cadence_days, 'YYYYMMDD'),
      'provider_key', 'master_trimmers',
      'preferred_weekday', trim(to_char(actual_service_date + cadence_days, 'Day')),
      'display_action', 'Did they come?',
      'display_subject', 'Master Trimmers',
      'display_detail', '$250 full-property mow · expected ' || to_char(actual_service_date + cadence_days, 'FMDay, Mon FMDD'),
      'cadence_anchor_service_date', actual_service_date::text,
      'next_task_policy', 'Create the next confirmation from the actual service date recorded on this card'
    ) as next_metadata
  from source
)
insert into atlas.planned_work_occurrences (
  farm_id,
  work_definition_id,
  release_policy_id,
  parent_occurrence_id,
  occurrence_key,
  source_kind,
  source_event_key,
  title,
  planned_due_date,
  not_before_date,
  state,
  task_payload,
  relation_payload,
  metadata,
  work_lane,
  commitment_kind,
  effort_units
)
select
  farm_id,
  work_definition_id,
  occurrence_release_policy_id,
  source_occurrence_id,
  'contractor_service:master_trimmers:' || next_date::text,
  'contractor_service_cadence',
  'master_trimmers:' || next_date::text,
  title,
  next_date,
  next_date,
  'planned',
  coalesce(source_payload, '{}'::jsonb) || jsonb_build_object(
    'status', 'open',
    'due_date', next_date::text,
    'completed_at', null,
    'completed_by', null,
    'metadata', next_metadata,
    'engine_instance_key', 'contractor_service:master_trimmers:' || next_date::text
  ),
  relation_payload,
  jsonb_build_object(
    'provider_key', 'master_trimmers',
    'cadence_source_service_date', actual_service_date::text,
    'cadence_days', cadence_days,
    'seeded_by', 'contractor_service_visit_status_v1'
  ),
  occurrence_work_lane,
  occurrence_commitment_kind,
  occurrence_effort_units
from prepared
where not exists (
  select 1
  from atlas.planned_work_occurrences existing
  where existing.work_definition_id = prepared.work_definition_id
    and existing.occurrence_key = 'contractor_service:master_trimmers:' || prepared.next_date::text
);
