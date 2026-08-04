-- An explicit due date is a presentation promise. Capacity still measures and
-- flags an overfilled day, but it cannot hide an open top-level task from the
-- assigned member on the date the owner selected.

create or replace function atlas.presented_work_rows_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null::date
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
begin
  select fm.role into v_target_role
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

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
      join atlas.tasks t on t.id = row.task_id
      where t.due_date = v_work_date
        and t.assigned_membership_id = p_membership_id
        and coalesce((t.metadata ->> 'allow_sunday')::boolean, false) is true
        and coalesce((t.metadata ->> 'owner_schedule_override')::boolean, false) is true
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
      when t.status = 'open'
       and t.due_date = v_work_date
       and row.presentation_state = 'held'
        then 'presented'
      else row.presentation_state
    end as presentation_state,
    case
      when t.status = 'open'
       and t.due_date = v_work_date
       and row.presentation_state = 'held'
       and row.presentation_reason in ('held_beyond_regular_minutes', 'held_beyond_recovery_minutes')
        then 'explicit_due_date_over_capacity'
      when t.status = 'open'
       and t.due_date = v_work_date
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
    row.overload or (
      t.status = 'open'
      and t.due_date = v_work_date
      and row.presentation_state = 'held'
      and row.presentation_reason in ('held_beyond_regular_minutes', 'held_beyond_recovery_minutes')
    ) as overload,
    row.task_card
  from atlas.presented_work_rows_unfiltered_v1(p_farm_id, p_membership_id, v_work_date) row
  join atlas.tasks t on t.id = row.task_id
  order by row.lane_order, row.selection_rank;
end;
$function$;
