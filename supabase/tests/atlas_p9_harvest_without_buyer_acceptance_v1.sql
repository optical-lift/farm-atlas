begin;

do $proof$
declare
  v_farm_id uuid;
  v_object_id uuid;
  v_cycle_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_key text := 'p9-acceptance-harvest-no-buyer-' || gen_random_uuid()::text;
  v_label text := 'P9 Acceptance No Buyer ' || substr(gen_random_uuid()::text,1,8);
  v_snapshot jsonb;
  v_commercial jsonb;
  v_req_id uuid;
  v_truth_id uuid;
  v_warrant jsonb;
  v_harvest_task_count integer;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key='elm_farm';

  select id into v_object_id
  from atlas.growing_objects
  where farm_id=v_farm_id
  order by created_at
  limit 1;

  if v_farm_id is null or v_object_id is null then
    raise exception 'Acceptance fixture requires elm_farm and one growing object.';
  end if;

  insert into atlas.crop_cycles(
    id,farm_id,object_id,crop_cycle_key,crop_label,variety,cycle_state,lifecycle_status,metadata
  ) values (
    v_cycle_id,v_farm_id,v_object_id,v_key,v_label,v_label,'established','active',
    jsonb_build_object('test_fixture','p9_harvest_without_buyer')
  );

  insert into atlas.crop_harvest_events(
    id,farm_id,crop_cycle_id,event_kind,outcome,observed_date,marketable_quantity,unit,idempotency_key,metadata
  ) values (
    v_event_id,v_farm_id,v_cycle_id,'watch','harvestable',current_date,12,'stems',
    'p9-acceptance-'||v_event_id::text,
    jsonb_build_object('test_fixture','p9_harvest_without_buyer')
  );

  insert into atlas.crop_harvest_availability(
    crop_cycle_id,farm_id,status,estimated_quantity,unit,observed_date,source_event_id,metadata
  ) values (
    v_cycle_id,v_farm_id,'harvestable',12,'stems',current_date,v_event_id,
    jsonb_build_object('test_fixture','p9_harvest_without_buyer')
  );

  v_snapshot := atlas.crop_cycle_requirement_snapshot_v1(v_cycle_id,current_date);
  v_commercial := atlas.crop_harvest_commercial_target_state_v1(v_cycle_id);

  if coalesce((v_snapshot->>'harvestResponseRequired')::boolean,false) is not true then
    raise exception 'Harvestability did not establish harvestResponseRequired. snapshot=%', v_snapshot;
  end if;

  if v_snapshot->>'requirementState' <> 'due'
     or v_snapshot->>'requirementOperationKey' <> 'harvest' then
    raise exception 'Harvest requirement did not resolve to due/harvest. snapshot=%', v_snapshot;
  end if;

  if v_commercial->>'state' <> 'decision_required' then
    raise exception 'No-buyer fixture should leave commercial target decision_required. commercial=%', v_commercial;
  end if;

  select i.id into v_req_id
  from atlas.state_consequence_instances i
  where i.subject_kind='crop_cycle'
    and i.subject_id=v_cycle_id
    and i.consequence_role='operation_requirement'
    and i.action_key='harvest'
    and i.status='open'
  order by i.created_at desc
  limit 1;

  if v_req_id is null then
    raise exception 'Harvestability did not materialize an open Harvest requirement instance.';
  end if;

  select i.id into v_truth_id
  from atlas.state_consequence_instances i
  where i.subject_kind='crop_cycle'
    and i.subject_id=v_cycle_id
    and i.consequence_role='truth_acquisition'
    and i.action_key='choose_harvest_disposition'
    and i.status='open'
    and i.source_requirement_instance_id=v_req_id
  order by i.created_at desc
  limit 1;

  if v_truth_id is null then
    raise exception 'Missing commercial target did not create a linked Owner truth-acquisition instance.';
  end if;

  v_warrant := atlas.crop_operation_execution_warrant_v1(v_cycle_id,'harvest',v_req_id);

  if coalesce((v_warrant->>'executionReady')::boolean,false) is not true
     or v_warrant->>'warrant' <> 'ready' then
    raise exception 'Commercial target gap incorrectly blocked Harvest execution. warrant=%', v_warrant;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_warrant->'nonBlockingUnknowns','[]'::jsonb)) x
    where x->>'kind'='commercial_target_required'
      and coalesce((x->>'blocksExecution')::boolean,true)=false
  ) then
    raise exception 'Harvest warrant did not preserve commercial_target_required as a nonblocking unknown. warrant=%', v_warrant;
  end if;

  select count(*)::integer into v_harvest_task_count
  from atlas.tasks t
  where t.metadata->>'source_requirement_instance_id'=v_req_id::text
    and t.metadata->>'source_requirement_action'='harvest'
    and t.status in ('open','blocked');

  if v_harvest_task_count <> 1 then
    raise exception 'Expected exactly one active Harvest execution carrier; found %.', v_harvest_task_count;
  end if;
end;
$proof$;

rollback;
