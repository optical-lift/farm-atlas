with farm as (
  select id,organization_id from atlas.farms where stable_key='elm_farm'
)
insert into atlas.tasks(
  farm_id,organization_id,title,task_type,status,priority,due_date,generated_from,
  metadata,action_key,work_class,visibility_scope,task_scope,origin_kind,work_lane,
  commitment_kind,effort_units,operation_class,operation_class_source
)
select
  f.id,f.organization_id,
  'Inspect + reclassify uncovered Grow Room propagation bodies',
  'propagation_reconciliation','open','high',null,'continuity_repair',
  jsonb_build_object(
    'task_key','continuity_20260818_grouped_grow_room_propagation_reconciliation',
    'repair_packet_key','audit:propagation_transition_uncovered',
    'repair_owner_function','farm_operations_propagation',
    'execution_do','Inspect each linked Grow Room propagation body and record its current physical state so Atlas can assign the lawful next operation, wait, destination gate, or terminal classification.',
    'execution_done_when','Every linked body has a current witness and is reclassified into a lawful continuation; inspection itself does not invent a transplant destination or claim the body is healthy.',
    'truth_boundary','One grouped inspection operation may observe many bodies. Each crop cycle remains a distinct subject and must be reclassified from its own witness.',
    'created_source','continuity_interlock_audit_20260818',
    'display_action','Inspect + reclassify','display_subject','Grow Room propagation bodies',
    'display_location','Grow Room','work_route','inspect_reconcile'
  ),
  'inspect','standard','management','farm_operation','generated','process_continuation',
  'persistent',1,'inspect_assess','continuity_repair_v1'
from farm f
where not exists (
  select 1 from atlas.tasks t
  where t.farm_id=f.id
    and t.metadata->>'task_key'='continuity_20260818_grouped_grow_room_propagation_reconciliation'
    and t.status in ('open','blocked')
);

with farm as (
  select id from atlas.farms where stable_key='elm_farm'
), repair_task as (
  select t.id from atlas.tasks t join farm f on f.id=t.farm_id
  where t.metadata->>'task_key'='continuity_20260818_grouped_grow_room_propagation_reconciliation'
    and t.status in ('open','blocked')
  order by t.created_at desc limit 1
), audit as (
  select atlas.farm_continuity_audit_v4(f.id,date '2026-08-18') as payload from farm f
), family as (
  select elem from audit a cross join lateral jsonb_array_elements(a.payload->'issueFamilies') elem
  where elem->>'key'='propagation_transition_uncovered'
), cycles as (
  select distinct (item->>'cycleId')::uuid as crop_cycle_id
  from family f cross join lateral jsonb_array_elements(f.elem->'items') item
  where item ? 'cycleId'
)
insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
select rt.id,c.crop_cycle_id,'observes','confirmed','continuity_repair_v1',
       jsonb_build_object('repairPacketKey','audit:propagation_transition_uncovered',
         'principle','Observation establishes present state; it does not itself establish destination, readiness, or completion.')
from repair_task rt cross join cycles c
on conflict (task_id,crop_cycle_id,role) do update
set confidence='confirmed',source='continuity_repair_v1',metadata=atlas.task_crop_cycles.metadata || excluded.metadata;

with farm as (
  select id,organization_id from atlas.farms where stable_key='elm_farm'
)
insert into atlas.tasks(
  farm_id,organization_id,title,task_type,status,priority,due_date,generated_from,
  metadata,action_key,work_class,visibility_scope,task_scope,origin_kind,work_lane,
  commitment_kind,effort_units,operation_class,operation_class_source
)
select
  f.id,f.organization_id,'Close First Lady Snapdragon cleanup state','crop_cleanup','open','high',null,'continuity_repair',
  jsonb_build_object(
    'task_key','continuity_20260818_first_lady_snapdragon_cleanup',
    'repair_packet_key','audit:closure_uncovered','repair_owner_function','farm_operations',
    'execution_do','Remove the First Lady Mixed Colors Snapdragon material already classified cleanup_needed, then record whether the source body is empty/closed or whether living material remains.',
    'execution_done_when','The physical cleanup is performed and the crop body is reclassified from a current witness; task completion alone must not imply the body is empty.',
    'truth_boundary','Cleanup work and terminal crop classification are separate claims; closure requires the resulting physical witness.',
    'created_source','continuity_interlock_audit_20260818','display_action','Clean up + close',
    'display_subject','First Lady Mixed Colors Snapdragon','display_location','Grow Room seed shelves','work_route','clear_reconcile'
  ),
  'clear','standard','management','farm_operation','generated','process_continuation',
  'persistent',1,'clear_demolish','continuity_repair_v1'
from farm f
where not exists (
  select 1 from atlas.tasks t
  where t.farm_id=f.id
    and t.metadata->>'task_key'='continuity_20260818_first_lady_snapdragon_cleanup'
    and t.status in ('open','blocked')
);

with farm as (
  select id from atlas.farms where stable_key='elm_farm'
), repair_task as (
  select t.id from atlas.tasks t join farm f on f.id=t.farm_id
  where t.metadata->>'task_key'='continuity_20260818_first_lady_snapdragon_cleanup'
    and t.status in ('open','blocked')
  order by t.created_at desc limit 1
), audit as (
  select atlas.farm_continuity_audit_v4(f.id,date '2026-08-18') as payload from farm f
), family as (
  select elem from audit a cross join lateral jsonb_array_elements(a.payload->'issueFamilies') elem
  where elem->>'key'='closure_uncovered'
), cycles as (
  select distinct (item->>'cycleId')::uuid as crop_cycle_id
  from family f cross join lateral jsonb_array_elements(f.elem->'items') item
  where item ? 'cycleId'
)
insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
select rt.id,c.crop_cycle_id,'clears','confirmed','continuity_repair_v1',
       jsonb_build_object('repairPacketKey','audit:closure_uncovered',
         'principle','The cleanup operation is warranted by cleanup_needed state; terminal classification still depends on the result witness.')
from repair_task rt cross join cycles c
on conflict (task_id,crop_cycle_id,role) do update
set confidence='confirmed',source='continuity_repair_v1',metadata=atlas.task_crop_cycles.metadata || excluded.metadata;

do $guard$
declare
  v_farm uuid;
  v_prop_task uuid;
  v_cleanup_task uuid;
  v_prop_links integer;
  v_cleanup_links integer;
begin
  select id into v_farm from atlas.farms where stable_key='elm_farm';
  select id into v_prop_task from atlas.tasks
   where farm_id=v_farm and metadata->>'task_key'='continuity_20260818_grouped_grow_room_propagation_reconciliation'
     and status in ('open','blocked') order by created_at desc limit 1;
  select id into v_cleanup_task from atlas.tasks
   where farm_id=v_farm and metadata->>'task_key'='continuity_20260818_first_lady_snapdragon_cleanup'
     and status in ('open','blocked') order by created_at desc limit 1;

  if v_prop_task is null or v_cleanup_task is null then
    raise exception 'Continuity repair task replay guard failed: expected repair tasks are missing.';
  end if;

  select count(*)::integer into v_prop_links from atlas.task_crop_cycles
   where task_id=v_prop_task and role='observes' and confidence='confirmed';
  select count(*)::integer into v_cleanup_links from atlas.task_crop_cycles
   where task_id=v_cleanup_task and role='clears' and confidence='confirmed';

  if v_prop_links <> 21 then
    raise exception 'Continuity repair task replay guard failed: expected 21 propagation links, found %.',v_prop_links;
  end if;
  if v_cleanup_links <> 1 then
    raise exception 'Continuity repair task replay guard failed: expected 1 cleanup link, found %.',v_cleanup_links;
  end if;
end;
$guard$;