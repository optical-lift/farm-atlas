create or replace function atlas.presented_work_rows_v1(p_farm_id uuid, p_membership_id uuid, p_work_date date default null::date)
returns table(task_id uuid, presentation_state text, presentation_reason text, lane_order integer, selection_rank bigint, work_lane text, commitment_kind text, effort_units numeric, budget_units numeric, notification_planned boolean, overload boolean, task_card jsonb)
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_work_date date:=coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_target_role text;
  v_target_worker_key text;
begin
  select membership.role,membership.worker_key into v_target_role,v_target_worker_key
  from atlas.farm_memberships membership
  where membership.id=p_membership_id and membership.farm_id=p_farm_id and membership.active=true;
  if v_target_role is null then raise exception 'Target membership is not active on this farm.' using errcode='42501'; end if;

  if exists(select 1 from atlas.member_unavailability unavailable where unavailable.farm_id=p_farm_id and unavailable.membership_id=p_membership_id and unavailable.active=true and v_work_date between unavailable.unavailable_start and unavailable.unavailable_end) then return; end if;

  if extract(dow from v_work_date)=0 and v_target_role='farm_hand' then
    return query
    with allowed as (
      select row.* from atlas.presented_work_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) row
      join atlas.tasks task on task.id=row.task_id
      where task.due_date=v_work_date and task.assigned_membership_id=p_membership_id
        and coalesce((task.metadata->>'allow_sunday')::boolean,false) is true
        and coalesce((task.metadata->>'owner_schedule_override')::boolean,false) is true
        and not exists (
          select 1
          from atlas.grow_room_round_requests rr
          join atlas.tasks visit on visit.id=rr.visit_task_id
          where rr.request_task_id=row.task_id
            and rr.resolved_at is null
            and visit.farm_id=p_farm_id
            and visit.status in ('open','blocked')
            and visit.assigned_membership_id=p_membership_id
        )
    )
    select allowed.task_id,'presented'::text,'owner_sunday_override'::text,allowed.lane_order,
      row_number() over(order by allowed.lane_order,allowed.selection_rank,allowed.task_id)::bigint,
      allowed.work_lane,allowed.commitment_kind,allowed.effort_units,allowed.budget_units,allowed.notification_planned,false,allowed.task_card
    from allowed order by 4,5;
    return;
  end if;

  return query
  select row.task_id,
    case
      when coalesce((sky.gate->>'withheldUnderSky')::boolean,false) then 'held'
      when task.status='open' and task.due_date<v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then 'presented'
      when task.status='open' and task.due_date=v_work_date and row.presentation_state='held' then 'presented'
      else row.presentation_state end,
    case
      when coalesce((sky.gate->>'withheldUnderSky')::boolean,false) then 'awaiting_favored_sky_window'
      when task.status='open' and task.due_date<v_work_date and accounting.noncounting_overdue then 'overdue_rescheduled_visible_noncounting'
      when task.status='open' and task.due_date<v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then 'overdue_visible_over_capacity'
      when task.status='open' and task.due_date=v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then 'explicit_due_date_over_capacity'
      when task.status='open' and task.due_date=v_work_date and row.presentation_state='held' then 'explicit_due_date'
      else row.presentation_reason end,
    row.lane_order,row.selection_rank,row.work_lane,row.commitment_kind,row.effort_units,row.budget_units,row.notification_planned,
    case
      when coalesce((sky.gate->>'withheldUnderSky')::boolean,false) then false
      when accounting.noncounting_overdue then false
      when task.status='open' and task.due_date<v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then true
      else row.overload or (task.status='open' and task.due_date=v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes')) end,
    row.task_card||jsonb_build_object('sky_timing',sky.gate)
  from atlas.presented_work_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) row
  join atlas.tasks task on task.id=row.task_id
  cross join lateral (select (task.due_date<v_work_date and atlas.task_rescheduled_by_membership_v1(task.id,p_membership_id,v_target_worker_key)) as noncounting_overdue) accounting
  cross join lateral (select atlas.task_sky_presentation_gate_v1(task.id,v_work_date) as gate) sky
  where (v_work_date<=v_today or task.due_date=v_work_date)
    and not exists (
      select 1
      from atlas.grow_room_round_requests rr
      join atlas.tasks visit on visit.id=rr.visit_task_id
      where rr.request_task_id=row.task_id
        and rr.resolved_at is null
        and visit.farm_id=p_farm_id
        and visit.status in ('open','blocked')
        and visit.assigned_membership_id=p_membership_id
    )
  order by row.lane_order,row.selection_rank;
end;$function$;
