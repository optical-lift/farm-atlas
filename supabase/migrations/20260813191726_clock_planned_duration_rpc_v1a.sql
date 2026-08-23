create or replace function atlas.owner_set_worker_day_task_duration_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_day date,
  p_duration_minutes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_placement atlas.worker_day_task_placements%rowtype;
  v_before integer;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  if p_duration_minutes is not null and (p_duration_minutes < 5 or p_duration_minutes > 720) then
    raise exception 'Clock duration must be between 5 and 720 minutes.' using errcode='22023';
  end if;

  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='owner'
      and fm.user_id=auth.uid()
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;

  select * into v_placement
  from atlas.worker_day_task_placements p
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id
    and p.task_id=p_task_id
    and p.service_date=p_day
    and p.state='placed'
  for update;

  if v_placement.id is null then
    raise exception 'Set a Clock start before adding a planned duration.' using errcode='55000';
  end if;

  v_before:=v_placement.planned_duration_minutes;

  update atlas.worker_day_task_placements
  set planned_duration_minutes=p_duration_minutes,
      updated_at=now()
  where id=v_placement.id
  returning * into v_placement;

  return jsonb_build_object(
    'contractVersion','worker_day_task_duration_v1',
    'placementId',v_placement.id,
    'taskId',v_placement.task_id,
    'serviceDate',v_placement.service_date,
    'plannedStartAt',v_placement.planned_start_at,
    'plannedDurationMinutes',v_placement.planned_duration_minutes,
    'changed',v_before is distinct from v_placement.planned_duration_minutes
  );
end;
$function$;