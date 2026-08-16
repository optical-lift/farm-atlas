-- Production-shaped rollback proof for Pass 3G / Worker Day Pass 9.
-- Run only after the migration is loaded in the same database session.
-- All policy changes are contained by this transaction and rolled back.

begin;

do $proof$
declare
  v_farm_id uuid := '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f';
  v_membership_id uuid := '23e98e5e-16ca-40d8-872c-c77e06baa167';
  v_task_count_before bigint;
  v_placement_count_before bigint;
  v_day jsonb;
  v_week jsonb;
begin
  select count(*) into v_task_count_before
  from atlas.tasks
  where farm_id=v_farm_id and assigned_membership_id=v_membership_id;

  select count(*) into v_placement_count_before
  from atlas.worker_day_task_placements
  where farm_id=v_farm_id and membership_id=v_membership_id;

  -- Isolate the proof from any real Day Shape that may be authored later.
  update atlas.worker_day_shape_policies
  set active=false, updated_at=now()
  where farm_id=v_farm_id and membership_id=v_membership_id and active=true;

  v_day := atlas.worker_week_day_capacity_v1(v_farm_id,v_membership_id,date '2026-08-17');
  if v_day->>'state' <> 'anchor_required'
     or coalesce((v_day->>'capacityKnown')::boolean,true)
     or v_day->'plannedCapacityMinutes' <> 'null'::jsonb then
    raise exception '3G proof failed: missing Day Shape must leave capacity unknown. Got %',v_day;
  end if;

  insert into atlas.worker_day_shape_policies(
    farm_id,membership_id,policy_key,policy_name,version,weekdays,
    local_start,local_end,effective_from,effective_through,active,authored_reason,metadata
  ) values (
    v_farm_id,v_membership_id,'rollback_proof_weekly_contract_20260816','Rollback proof Mon-Fri',1,
    array[1,2,3,4,5]::smallint[],'08:00'::time,'15:00'::time,
    date '2026-08-17',date '2026-08-23',true,'transaction-only proof',jsonb_build_object('proof',true)
  );

  v_day := atlas.worker_week_day_capacity_v1(v_farm_id,v_membership_id,date '2026-08-17');
  if v_day->>'capacityClass' <> 'planned'
     or coalesce((v_day->>'plannedCapacityMinutes')::integer,0) <= 0 then
    raise exception '3G proof failed: authored Monday should create normal planned capacity. Got %',v_day;
  end if;

  v_day := atlas.worker_week_day_capacity_v1(v_farm_id,v_membership_id,date '2026-08-22');
  if v_day->>'state' <> 'non_working_day'
     or coalesce((v_day->>'plannedCapacityMinutes')::integer,-1) <> 0
     or coalesce((v_day->>'recoveryCapacityMinutes')::integer,-1) <> 0 then
    raise exception '3G proof failed: unauthored Saturday must be a non-working day. Got %',v_day;
  end if;

  update atlas.worker_day_shape_policies
  set weekdays=array[0,1,2,3,4,5,6]::smallint[], updated_at=now()
  where farm_id=v_farm_id and membership_id=v_membership_id
    and policy_key='rollback_proof_weekly_contract_20260816' and version=1;

  v_day := atlas.worker_week_day_capacity_v1(v_farm_id,v_membership_id,date '2026-08-22');
  if v_day->>'capacityClass' <> 'recovery'
     or coalesce((v_day->>'plannedCapacityMinutes')::integer,-1) <> 0
     or coalesce((v_day->>'recoveryCapacityMinutes')::integer,0) <= 0 then
    raise exception '3G proof failed: authored Saturday must remain recovery-only. Got %',v_day;
  end if;

  v_day := atlas.worker_week_day_capacity_v1(v_farm_id,v_membership_id,date '2026-08-23');
  if v_day->>'capacityClass' <> 'explicit_override'
     or coalesce((v_day->>'plannedCapacityMinutes')::integer,-1) <> 0
     or coalesce((v_day->>'recoveryCapacityMinutes')::integer,0) <= 0 then
    raise exception '3G proof failed: authored Sunday must remain explicit-override/recovery-only. Got %',v_day;
  end if;

  v_week := atlas.worker_weekly_farm_contract_v1(v_farm_id,v_membership_id,date '2026-08-17');
  if v_week->>'capacityUsesOwnerAuthoredDayShapeOnly' <> 'true' then
    raise exception '3G proof failed: weekly contract lost authored-capacity boundary. Got %',v_week;
  end if;
  if coalesce((v_week->>'plannedCapacityMinutes')::integer,-1) < 0
     or coalesce((v_week->>'recoveryCapacityMinutes')::integer,-1) < 0 then
    raise exception '3G proof failed: weekly contract did not produce separated capacity totals. Got %',v_week;
  end if;

  perform atlas.worker_weekly_farm_contract_v1(v_farm_id,v_membership_id,date '2026-08-17');

  if (select count(*) from atlas.tasks where farm_id=v_farm_id and assigned_membership_id=v_membership_id) <> v_task_count_before then
    raise exception '3G proof failed: reading Weekly Farm Contract changed task count.';
  end if;
  if (select count(*) from atlas.worker_day_task_placements where farm_id=v_farm_id and membership_id=v_membership_id) <> v_placement_count_before then
    raise exception '3G proof failed: reading Weekly Farm Contract changed placement count.';
  end if;
end;
$proof$;

rollback;
