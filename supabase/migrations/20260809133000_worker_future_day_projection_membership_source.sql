create or replace function atlas.worker_future_day_projection_source_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_paid_target integer;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.user_id = v_user_id
      and fm.farm_id = p_farm_id
      and fm.active = true
  ) then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  select fm.role
    into v_role
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true
  limit 1;

  if v_role is null then
    raise exception 'Target membership is not active for this farm.' using errcode = '42501';
  end if;

  select mcs.regular_target_minutes
    into v_paid_target
  from atlas.member_capacity_settings mcs
  where mcs.farm_id = p_farm_id
    and mcs.membership_id = p_membership_id
    and mcs.active = true
  limit 1;

  v_paid_target := coalesce(
    v_paid_target,
    case
      when v_role = 'farm_hand' then 420
      when v_role = 'manager' then 360
      else 480
    end
  );

  return jsonb_build_object(
    'role', v_role,
    'paidTargetMinutes', v_paid_target,
    'projection', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'plannedDate', o.planned_date,
          'sourceKind', o.source_kind,
          'sourceId', o.source_id,
          'title', o.title,
          'planState', o.plan_state,
          'environment', o.environment,
          'expectedActiveMinutes', o.expected_active_minutes,
          'reason', o.reason,
          'planOrder', o.plan_order
        )
        order by o.planned_date, o.plan_order, o.id
      )
      from atlas.owner_week_projection o
      where o.farm_id = p_farm_id
        and o.membership_id = p_membership_id
        and o.planned_date between p_start_date and p_end_date
    ), '[]'::jsonb),
    'weedQueue', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position', qi.position,
          'state', qi.state,
          'plannedOccurrenceId', qi.planned_occurrence_id,
          'occurrenceState', pwo.state,
          'title', pwo.title,
          'taskPayload', pwo.task_payload
        )
        order by qi.position
      )
      from atlas.task_release_queue_items qi
      left join atlas.planned_work_occurrences pwo on pwo.id = qi.planned_occurrence_id
      where qi.farm_id = p_farm_id
        and qi.queue_key = 'anna_weeding_rotation'
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function atlas.worker_future_day_projection_source_v1(uuid,uuid,date,date) from public, anon;
grant execute on function atlas.worker_future_day_projection_source_v1(uuid,uuid,date,date) to authenticated;
