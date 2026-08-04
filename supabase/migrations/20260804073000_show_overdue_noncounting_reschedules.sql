-- Keep overdue work visible while preserving owner-private capacity accounting.
-- Work that the assigned worker rescheduled remains visible as backlog but does
-- not consume the current day's planned minutes.

begin;

create or replace function atlas.task_rescheduled_by_membership_v1(
  p_task_id uuid,
  p_membership_id uuid,
  p_worker_key text default null
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

revoke all on function atlas.task_rescheduled_by_membership_v1(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function atlas.task_rescheduled_by_membership_v1(uuid,uuid,text)
  to service_role;

create or replace function atlas.presented_work_rows_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
)
returns table(
  task_id uuid,
  presentation_state text,
  presentation_reason text,
  lane_order integer,
  selection_rank bigint,
  work_lane text,
  commitment_kind text,
  effort_units numeric,
  budget_units numeric,
  notification_planned boolean,
  overload boolean,
  task_card jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_work_date date := coalesce(p_work_date, (now() at time zone 'America/Chicago')::date);
  v_target_role text;
  v_target_worker_key text;
begin
  select membership.role, membership.worker_key
  into v_target_role, v_target_worker_key
  from atlas.farm_memberships membership
  where membership.id = p_membership_id
    and membership.farm_id = p_farm_id
    and membership.active = true;

  if v_target_role is null then
    raise exception 'Target membership is not active on this farm.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from atlas.member_unavailability unavailable
    where unavailable.farm_id = p_farm_id
      and unavailable.membership_id = p_membership_id
      and unavailable.active = true
      and v_work_date between unavailable.unavailable_start and unavailable.unavailable_end
  ) then
    return;
  end if;

  if extract(dow from v_work_date) = 0 and v_target_role = 'farm_hand' then
    return query
    with allowed as (
      select row.*
      from atlas.presented_work_rows_unfiltered_v1(p_farm_id, p_membership_id, v_work_date) row
      join atlas.tasks task on task.id = row.task_id
      where task.due_date = v_work_date
        and task.assigned_membership_id = p_membership_id
        and coalesce((task.metadata ->> 'allow_sunday')::boolean, false) is true
        and coalesce((task.metadata ->> 'owner_schedule_override')::boolean, false) is true
    )
    select
      allowed.task_id,
      'presented'::text,
      'owner_sunday_override'::text,
      allowed.lane_order,
      row_number() over (
        order by allowed.lane_order, allowed.selection_rank, allowed.task_id
      )::bigint,
      allowed.work_lane,
      allowed.commitment_kind,
      allowed.effort_units,
      allowed.budget_units,
      allowed.notification_planned,
      false,
      allowed.task_card
    from allowed
    order by 4, 5;
    return;
  end if;

  return query
  select
    row.task_id,
    case
      when task.status = 'open'
       and task.due_date < v_work_date
       and row.presentation_state = 'held'
       and row.presentation_reason in ('held_beyond_regular_minutes', 'held_beyond_recovery_minutes')
        then 'presented'
      when task.status = 'open'
       and task.due_date = v_work_date
       and row.presentation_state = 'held'
        then 'presented'
      else row.presentation_state
    end as presentation_state,
    case
      when task.status = 'open'
       and task.due_date < v_work_date
       and accounting.noncounting_overdue
        then 'overdue_rescheduled_visible_noncounting'
      when task.status = 'open'
       and task.due_date < v_work_date
       and row.presentation_state = 'held'
       and row.presentation_reason in ('held_beyond_regular_minutes', 'held_beyond_recovery_minutes')
        then 'overdue_visible_over_capacity'
      when task.status = 'open'
       and task.due_date = v_work_date
       and row.presentation_state = 'held'
       and row.presentation_reason in ('held_beyond_regular_minutes', 'held_beyond_recovery_minutes')
        then 'explicit_due_date_over_capacity'
      when task.status = 'open'
       and task.due_date = v_work_date
       and row.presentation_state = 'held'
        then 'explicit_due_date'
      else row.presentation_reason
    end as presentation_reason,
    row.lane_order,
    row.selection_rank,
    row.work_lane,
    row.commitment_kind,
    row.effort_units,
    row.budget_units,
    row.notification_planned,
    case
      when accounting.noncounting_overdue then false
      when task.status = 'open'
       and task.due_date < v_work_date
       and row.presentation_state = 'held'
       and row.presentation_reason in ('held_beyond_regular_minutes', 'held_beyond_recovery_minutes')
        then true
      else row.overload or (
        task.status = 'open'
        and task.due_date = v_work_date
        and row.presentation_state = 'held'
        and row.presentation_reason in ('held_beyond_regular_minutes', 'held_beyond_recovery_minutes')
      )
    end as overload,
    row.task_card
  from atlas.presented_work_rows_unfiltered_v1(p_farm_id, p_membership_id, v_work_date) row
  join atlas.tasks task on task.id = row.task_id
  cross join lateral (
    select (
      task.due_date < v_work_date
      and atlas.task_rescheduled_by_membership_v1(task.id, p_membership_id, v_target_worker_key)
    ) as noncounting_overdue
  ) accounting
  order by row.lane_order, row.selection_rank;
end;
$function$;

create or replace function atlas.owner_capacity_plan_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_work_date date := coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_role text;
  v_member_role text;
  v_worker_key text;
  v_settings atlas.member_capacity_settings%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_regular_minutes integer := 0;
  v_recovery_minutes integer := 0;
  v_heavy_minutes integer := 0;
  v_noncounting_overdue_minutes integer := 0;
  v_noncounting_overdue_count integer := 0;
  v_presented_count integer := 0;
  v_held_count integer := 0;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  if v_role <> 'owner' then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;

  select membership.role,membership.worker_key
  into v_member_role,v_worker_key
  from atlas.farm_memberships membership
  where membership.id=p_membership_id and membership.farm_id=p_farm_id and membership.active;
  if v_member_role is null then
    raise exception 'Target membership is not active on this farm.' using errcode='P0002';
  end if;

  select * into v_settings
  from atlas.member_capacity_settings
  where membership_id=p_membership_id and farm_id=p_farm_id and active;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'taskId',task.id,
      'title',task.title,
      'dueDate',task.due_date,
      'presentationState',presented.presentation_state,
      'presentationReason',presented.presentation_reason,
      'expectedActiveMinutes',capacity.expected_active_minutes,
      'physicalLoad',capacity.physical_load,
      'baseObligationClass',capacity.base_obligation_class,
      'effectiveObligationClass',capacity.effective_obligation_class,
      'microRoundKey',capacity.micro_round_key,
      'estimateSource',capacity.estimate_source,
      'estimateConfidence',capacity.estimate_confidence,
      'recoveryOriginDueDate',capacity.recovery_origin_due_date,
      'countsTowardDay',not accounting.noncounting_overdue,
      'capacityTreatment',case
        when accounting.noncounting_overdue then 'overdue_rescheduled_noncounting'
        else 'counted'
      end
    ) order by presented.lane_order,presented.selection_rank),'[]'::jsonb),
    coalesce(sum(capacity.expected_active_minutes) filter(
      where presented.presentation_state='presented'
        and not accounting.noncounting_overdue
        and capacity.effective_obligation_class<>'recovery_work'),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(
      where presented.presentation_state='presented'
        and not accounting.noncounting_overdue
        and capacity.effective_obligation_class='recovery_work'),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(
      where presented.presentation_state='presented'
        and not accounting.noncounting_overdue
        and capacity.physical_load='heavy'),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(
      where presented.presentation_state='presented'
        and accounting.noncounting_overdue),0)::integer,
    count(*) filter(
      where presented.presentation_state='presented'
        and accounting.noncounting_overdue)::integer,
    count(*) filter(where presented.presentation_state='presented')::integer,
    count(*) filter(where presented.presentation_state='held')::integer
  into
    v_items,
    v_regular_minutes,
    v_recovery_minutes,
    v_heavy_minutes,
    v_noncounting_overdue_minutes,
    v_noncounting_overdue_count,
    v_presented_count,
    v_held_count
  from atlas.presented_work_rows_v1(p_farm_id,p_membership_id,v_work_date) presented
  join atlas.tasks task on task.id=presented.task_id
  cross join lateral atlas.task_capacity_plan_v1(task,v_work_date) capacity
  cross join lateral (
    select (
      task.due_date < v_work_date
      and atlas.task_rescheduled_by_membership_v1(task.id, p_membership_id, v_worker_key)
    ) as noncounting_overdue
  ) accounting;

  return jsonb_build_object(
    'contractVersion','owner_capacity_plan_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'workDate',v_work_date,
    'member',jsonb_build_object('role',v_member_role,'workerKey',v_worker_key),
    'settings',jsonb_build_object(
      'regularTargetMinutes',coalesce(v_settings.regular_target_minutes,case v_member_role when 'farm_hand' then 300 when 'manager' then 360 else 480 end),
      'recoveryTargetMinutes',coalesce(v_settings.recovery_target_minutes,case v_member_role when 'farm_hand' then 90 when 'manager' then 60 else 0 end),
      'maximumPlannedMinutes',coalesce(v_settings.maximum_planned_minutes,case v_member_role when 'farm_hand' then 420 when 'manager' then 480 else 600 end),
      'heavyMinutesSoftCap',coalesce(v_settings.heavy_minutes_soft_cap,case v_member_role when 'farm_hand' then 210 when 'manager' then 240 else 300 end)
    ),
    'summary',jsonb_build_object(
      'selectedRegularMinutes',v_regular_minutes,
      'selectedRecoveryMinutes',v_recovery_minutes,
      'selectedTotalMinutes',v_regular_minutes+v_recovery_minutes,
      'selectedHeavyMinutes',v_heavy_minutes,
      'noncountingOverdueMinutes',v_noncounting_overdue_minutes,
      'noncountingOverdueCount',v_noncounting_overdue_count,
      'presentedCount',v_presented_count,
      'heldCount',v_held_count
    ),
    'items',v_items
  );
end;
$function$;

revoke all on function atlas.presented_work_rows_v1(uuid,uuid,date)
  from public, anon, authenticated;
grant execute on function atlas.presented_work_rows_v1(uuid,uuid,date)
  to service_role;

revoke all on function atlas.owner_capacity_plan_v1(uuid,uuid,date)
  from public, anon;
grant execute on function atlas.owner_capacity_plan_v1(uuid,uuid,date)
  to authenticated, service_role;

-- CREATE OR REPLACE preserves the existing signed-in endpoint ACL. Record that
-- this owner-only reader was re-reviewed, and fail closed if its governed RPC
-- registry entry is missing or no longer expects authenticated execution.
update atlas.authenticated_rpc_registry
set evidence = evidence || jsonb_build_object(
      'source', 'show_overdue_noncounting_reschedules',
      'authorization', 'owner farm membership required',
      'reviewed_date', '2026-08-04'
    ),
    reviewed_at = now()
where signature = 'atlas.owner_capacity_plan_v1(uuid, uuid, date)'
  and authenticated_execute_expected;

do $verify_registry$
begin
  if not exists (
    select 1
    from atlas.authenticated_rpc_registry
    where signature = 'atlas.owner_capacity_plan_v1(uuid, uuid, date)'
      and authenticated_execute_expected
      and security_definer_expected
  ) then
    raise exception 'owner_capacity_plan_v1 authenticated RPC registry reconciliation is incomplete.';
  end if;
end;
$verify_registry$;

commit;
