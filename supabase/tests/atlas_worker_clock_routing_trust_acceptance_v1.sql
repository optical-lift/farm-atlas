begin;

do $proof$
declare
  v_bridge_definition text;
  v_definition_metadata jsonb;
  v_task_metadata jsonb;
  v_day_window text;
begin
  select pg_get_functiondef(
    'atlas.worker_state_transition_selection_bridge_v1(uuid,uuid,uuid,date,jsonb)'::regprocedure
  ) into v_bridge_definition;

  if v_bridge_definition is null then
    raise exception 'Worker selected-day routing bridge is missing.';
  end if;

  if position('not_placed_for_worker_day' in v_bridge_definition)=0
     or position('presented_work_selection_rows_v1' in v_bridge_definition)=0
     or position('task_execution_readiness_v1' in v_bridge_definition)=0
     or position('definiteCapacityConflict' in v_bridge_definition)=0
     or position('subjectCount' in v_bridge_definition)=0 then
    raise exception 'Worker selected-day bridge is missing one or more trust boundaries.';
  end if;

  if position('plannedStartAt' in v_bridge_definition)=0
     or position('doesNotCreateClockPlacement' in v_bridge_definition)=0
     or position('doesNotBypassCropOrProductionReality' in v_bridge_definition)=0 then
    raise exception 'Worker selected-day bridge no longer states its Clock/subject truth boundary.';
  end if;

  select metadata into v_definition_metadata
  from atlas.work_definitions
  where id='3199c7cc-d4d4-4838-9de2-a200a92a4615'::uuid
    and farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;

  if v_definition_metadata is null then
    raise exception 'Canonical Chicken Chore work definition is missing.';
  end if;

  if coalesce((v_definition_metadata->>'opening_routine')::boolean,false) is not true
     or coalesce(v_definition_metadata->>'work_order_anchor','') <> 'top' then
    raise exception 'Canonical Chicken Chore definition does not carry opening-routine/top-of-day semantics. metadata=%',v_definition_metadata;
  end if;

  v_day_window:=atlas.worker_task_day_window_v1('feed','animal_care',v_definition_metadata);
  if v_day_window <> 'morning' then
    raise exception 'Opening-routine animal care must resolve to morning, got %.',v_day_window;
  end if;

  select metadata into v_task_metadata
  from atlas.tasks
  where id='b8ce42aa-387f-4f8c-8ce9-cc5384efbdae'::uuid
    and farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;

  if v_task_metadata is not null
     and (
       coalesce((v_task_metadata->>'opening_routine')::boolean,false) is not true
       or coalesce(v_task_metadata->>'work_order_anchor','') <> 'top'
     ) then
    raise exception 'Current Chicken Chore task exists without opening-routine/top-of-day semantics. metadata=%',v_task_metadata;
  end if;
end;
$proof$;

rollback;
