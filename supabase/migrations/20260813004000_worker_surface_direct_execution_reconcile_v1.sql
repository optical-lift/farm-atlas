begin;

-- These were accidentally offered to the future-work release gate while we were
-- converting already-owned live work into a better worker shape. None released.
with live_sources as (
  select id from atlas.tasks where metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
  union
  select id from atlas.tasks where title='Hang conference-room café lights + porch solar lights' and assigned_membership_id is not null
  union
  select id from atlas.tasks where metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping'
)
update atlas.planned_work_occurrences o
set state='cancelled',
    metadata=coalesce(o.metadata,'{}'::jsonb) || jsonb_build_object(
      'cancelled_by','worker_surface_direct_execution_reconcile_v1',
      'cancelled_reason','Live execution child/split, not reservoir work',
      'cancelled_at',now()
    ),
    updated_at=now()
where o.source_kind in ('grouped_worker_move','worker_surface_split','station_checklist')
  and o.released_task_id is null
  and (
    o.source_id in (select id from live_sources)
    or o.title in (
      'Sow ProCut Horizon — BW7','Sow ProCut Horizon — BW8',
      'Venue Lighting — Conference Room Café Lights','Venue Lighting — Porch Solar Lights',
      'Coffee Bar — Start Cold Brew','Wrapping Station — Stage Thursday Supplies',
      'Coffee Bar — Add coffee + water','Coffee Bar — Stir','Coffee Bar — Refrigerate',
      'Wrapping Station — Brown paper','Wrapping Station — Stamp','Wrapping Station — Rubber bands',
      'Wrapping Station — Flower food','Wrapping Station — Sharpie','Wrapping Station — Stickers'
    )
  );

-- A visible Horizon card groups two independent bed state containers. The
-- parent owns calendar/release truth; children therefore have no generated_from.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,parent_task_id,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,
  work_lane,commitment_kind,operation_class,operation_class_source,task_scope,
  created_at,updated_at
)
select p.farm_id,p.organization_id,p.zone_id,'Sow ProCut Horizon — BW7','sowing_bed','open',p.priority,p.due_date,
  jsonb_build_object(
    'task_key','owner_20260808_sow_procut_horizon_bw7',
    'group_source_task_id',p.id,
    'surface_source_kind','grouped_worker_move',
    'stateful_child',true,'worker_execution_child',true,
    'checklist_group_label','Beds','checklist_label','BW7','checklist_action_label','Mark sown',
    'display_action','Sow','display_subject','BW7','display_location',g.label,
    'planting_log_required',true,'planting_log_auto_capture',true,
    'planting_log_default_amount','1','planting_log_unit','bed',
    'planting_log_default_zone_id',p.zone_id::text,'planting_log_default_object_id',g.id::text,
    'planting_log_default_location',g.label,'planting_log_crop_label','Sunflower',
    'planting_log_variety','ProCut Horizon','planting_method','direct_sow',
    'crop_profile_id',p.metadata->>'crop_profile_id','crop_profile_stable_key','sunflower_procut_horizon',
    'rows_per_3ft_bed',3,'in_row_spacing_in',4
  ),
  'sow','standard',p.id,'assigned_worker',p.assigned_membership_id,p.assigned_user_id,
  p.created_by_user_id,p.origin_kind,p.work_lane,p.commitment_kind,
  coalesce(p.operation_class,'establish_aboveground'),'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks p
join atlas.growing_objects g on g.zone_id=p.zone_id and g.stable_key='bw_7'
where p.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
  and not exists (select 1 from atlas.tasks c where c.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7');

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,parent_task_id,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,
  work_lane,commitment_kind,operation_class,operation_class_source,task_scope,
  created_at,updated_at
)
select p.farm_id,p.organization_id,p.zone_id,'Sow ProCut Horizon — BW8','sowing_bed','open',p.priority,p.due_date,
  jsonb_build_object(
    'task_key','owner_20260808_sow_procut_horizon_bw8',
    'group_source_task_id',p.id,
    'surface_source_kind','grouped_worker_move',
    'stateful_child',true,'worker_execution_child',true,
    'checklist_group_label','Beds','checklist_label','BW8','checklist_action_label','Mark sown',
    'display_action','Sow','display_subject','BW8','display_location',g.label,
    'planting_log_required',true,'planting_log_auto_capture',true,
    'planting_log_default_amount','1','planting_log_unit','bed',
    'planting_log_default_zone_id',p.zone_id::text,'planting_log_default_object_id',g.id::text,
    'planting_log_default_location',g.label,'planting_log_crop_label','Sunflower',
    'planting_log_variety','ProCut Horizon','planting_method','direct_sow',
    'crop_profile_id',p.metadata->>'crop_profile_id','crop_profile_stable_key','sunflower_procut_horizon',
    'rows_per_3ft_bed',3,'in_row_spacing_in',4
  ),
  'sow','standard',p.id,'assigned_worker',p.assigned_membership_id,p.assigned_user_id,
  p.created_by_user_id,p.origin_kind,p.work_lane,p.commitment_kind,
  coalesce(p.operation_class,'establish_aboveground'),'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks p
join atlas.growing_objects g on g.zone_id=p.zone_id and g.stable_key='bw_8'
where p.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
  and not exists (select 1 from atlas.tasks c where c.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw8');

insert into atlas.task_objects(task_id,object_id,role)
select c.id,g.id,'target'
from atlas.tasks c
join atlas.tasks p on p.id=c.parent_task_id
join atlas.growing_objects g on g.zone_id=p.zone_id
where (c.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7' and g.stable_key='bw_7')
   or (c.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw8' and g.stable_key='bw_8')
on conflict (task_id,object_id) do nothing;

-- Split one combined lighting card into two actual physical operations.
with source as (
  select * from atlas.tasks
  where title='Hang conference-room café lights + porch solar lights'
    and assigned_membership_id is not null
    and metadata ? 'superseded_by_task_keys'
  order by updated_at desc limit 1
)
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,visibility_scope,assigned_membership_id,
  assigned_user_id,created_by_user_id,origin_kind,work_lane,commitment_kind,
  operation_class_source,task_scope,created_at,updated_at
)
select s.farm_id,s.organization_id,s.zone_id,'Venue Lighting — Conference Room Café Lights','venue_lighting','open',s.priority,
  coalesce((s.metadata#>>'{last_transition,target_date}')::date,date '2026-08-12'),
  jsonb_build_object(
    'task_key','anna_20260812_venue_lighting_conference_room','source_task_id',s.id,
    'surface_source_kind','worker_surface_split','display_family','Venue Lighting','operation_family','Venue Lighting',
    'display_action','Hang','display_subject','Café lights','display_location','Conference room',
    'execution_place','Conference room','execution_do','Hang café lights from ceiling hooks.',
    'window_key','evening','work_order_anchor','evening'
  ),
  'hang','standard','assigned_worker',s.assigned_membership_id,s.assigned_user_id,s.created_by_user_id,
  s.origin_kind,s.work_lane,s.commitment_kind,'worker_surface_grammar_v1','farm_operation',now(),now()
from source s
where not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_venue_lighting_conference_room');

with source as (
  select * from atlas.tasks
  where title='Hang conference-room café lights + porch solar lights'
    and assigned_membership_id is not null
    and metadata ? 'superseded_by_task_keys'
  order by updated_at desc limit 1
)
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,visibility_scope,assigned_membership_id,
  assigned_user_id,created_by_user_id,origin_kind,work_lane,commitment_kind,
  operation_class_source,task_scope,created_at,updated_at
)
select s.farm_id,s.organization_id,s.zone_id,'Venue Lighting — Porch Solar Lights','venue_lighting','open',s.priority,
  coalesce((s.metadata#>>'{last_transition,target_date}')::date,date '2026-08-12'),
  jsonb_build_object(
    'task_key','anna_20260812_venue_lighting_porch_solar','source_task_id',s.id,
    'surface_source_kind','worker_surface_split','display_family','Venue Lighting','operation_family','Venue Lighting',
    'display_action','Place','display_subject','Solar lights','display_location','Porches',
    'execution_place','Porches','execution_do','Place solar lights outside and position them to charge.',
    'window_key','evening','work_order_anchor','evening'
  ),
  'place','standard','assigned_worker',s.assigned_membership_id,s.assigned_user_id,s.created_by_user_id,
  s.origin_kind,s.work_lane,s.commitment_kind,'worker_surface_grammar_v1','farm_operation',now(),now()
from source s
where not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_venue_lighting_porch_solar');

-- Split the combined hospitality prep into the two durable stations it changes.
with source as (
  select * from atlas.tasks
  where metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping'
  order by updated_at desc limit 1
)
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,visibility_scope,assigned_membership_id,
  assigned_user_id,created_by_user_id,origin_kind,work_lane,commitment_kind,
  operation_class_source,task_scope,created_at,updated_at
)
select s.farm_id,s.organization_id,s.zone_id,'Coffee Bar — Start Cold Brew','hospitality_prep','open',s.priority,date '2026-08-12',
  jsonb_build_object(
    'task_key','anna_20260812_coffee_bar_start_cold_brew','source_task_id',s.id,
    'surface_source_kind','worker_surface_split','display_family','Coffee Bar','operation_family','Coffee Bar',
    'display_action','Prepare','display_subject','Cold brew','display_location','Coffee Bar','execution_place','Coffee Bar',
    'execution_do','Start the cold brew for Thursday.','operation_place_key','coffee_bar','place_readiness_on_done',true,
    'window_key','evening','work_order_anchor','evening'
  ),
  'prepare','standard','assigned_worker',s.assigned_membership_id,s.assigned_user_id,s.created_by_user_id,
  s.origin_kind,s.work_lane,s.commitment_kind,'worker_surface_grammar_v1','farm_operation',now(),now()
from source s
where not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_coffee_bar_start_cold_brew');

with source as (
  select * from atlas.tasks
  where metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping'
  order by updated_at desc limit 1
)
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,visibility_scope,assigned_membership_id,
  assigned_user_id,created_by_user_id,origin_kind,work_lane,commitment_kind,
  operation_class_source,task_scope,created_at,updated_at
)
select s.farm_id,s.organization_id,s.zone_id,'Wrapping Station — Stage Thursday Supplies','fulfillment_prep','open',s.priority,date '2026-08-12',
  jsonb_build_object(
    'task_key','anna_20260812_wrapping_station_stage_supplies','source_task_id',s.id,
    'surface_source_kind','worker_surface_split','display_family','Wrapping Station','operation_family','Wrapping Station',
    'display_action','Stage','display_subject','Thursday wrapping supplies','display_location','Wrapping station',
    'execution_place','Wrapping station','execution_do','Stage the wrapping station for Thursday.',
    'operation_place_key','bouquet_wrapping_station','place_readiness_on_done',true,
    'window_key','evening','work_order_anchor','evening'
  ),
  'stage','standard','assigned_worker',s.assigned_membership_id,s.assigned_user_id,s.created_by_user_id,
  s.origin_kind,s.work_lane,s.commitment_kind,'worker_surface_grammar_v1','farm_operation',now(),now()
from source s
where not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_wrapping_station_stage_supplies');

-- Child rows are visible checklist state, not downstream handoffs. Their parent
-- relationship is the provenance, so do not use source_task_id here.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,parent_task_id,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,
  work_lane,commitment_kind,operation_class_source,task_scope,created_at,updated_at
)
select p.farm_id,p.organization_id,p.zone_id,v.title,'checklist_step','open',p.priority,p.due_date,
  jsonb_build_object(
    'task_key',v.task_key,'station_parent_task_id',p.id,'surface_source_kind','station_checklist',
    'stateful_child',true,'worker_execution_child',true,'checklist_group_label','Cold brew',
    'checklist_label',v.label,'checklist_action_label','Mark complete'
  ),
  'check','light',p.id,'assigned_worker',p.assigned_membership_id,p.assigned_user_id,p.created_by_user_id,
  p.origin_kind,p.work_lane,p.commitment_kind,'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks p
cross join lateral (values
  ('Coffee Bar — Add coffee + water','anna_20260812_coffee_bar_step_mix','2 cups grounds + 6 cups cold water'),
  ('Coffee Bar — Stir','anna_20260812_coffee_bar_step_stir','Stir until all grounds are wet'),
  ('Coffee Bar — Refrigerate','anna_20260812_coffee_bar_step_chill','Cover + refrigerate 12–16 hr')
) v(title,task_key,label)
where p.metadata->>'task_key'='anna_20260812_coffee_bar_start_cold_brew'
  and not exists (select 1 from atlas.tasks c where c.metadata->>'task_key'=v.task_key);

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,parent_task_id,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,
  work_lane,commitment_kind,operation_class_source,task_scope,created_at,updated_at
)
select p.farm_id,p.organization_id,p.zone_id,v.title,'checklist_step','open',p.priority,p.due_date,
  jsonb_build_object(
    'task_key',v.task_key,'station_parent_task_id',p.id,'surface_source_kind','station_checklist',
    'stateful_child',true,'worker_execution_child',true,'checklist_group_label','Station',
    'checklist_label',v.label,'checklist_action_label','Mark staged'
  ),
  'stage','light',p.id,'assigned_worker',p.assigned_membership_id,p.assigned_user_id,p.created_by_user_id,
  p.origin_kind,p.work_lane,p.commitment_kind,'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks p
cross join lateral (values
  ('Wrapping Station — Brown paper','anna_20260812_wrapping_step_paper','Brown paper rectangles'),
  ('Wrapping Station — Stamp','anna_20260812_wrapping_step_stamp','Elm stamp + ink pad'),
  ('Wrapping Station — Rubber bands','anna_20260812_wrapping_step_bands','Green rubber bands'),
  ('Wrapping Station — Flower food','anna_20260812_wrapping_step_food','Flower food packets'),
  ('Wrapping Station — Sharpie','anna_20260812_wrapping_step_sharpie','Black Sharpie'),
  ('Wrapping Station — Stickers','anna_20260812_wrapping_step_stickers','Elm stickers')
) v(title,task_key,label)
where p.metadata->>'task_key'='anna_20260812_wrapping_station_stage_supplies'
  and not exists (select 1 from atlas.tasks c where c.metadata->>'task_key'=v.task_key);

-- Preserve the source project links without reusing generated_from as a release signal.
insert into atlas.project_task_links(project_id,task_id,link_role,sort_order,source,metadata,parent_task_id,created_at,updated_at)
select l.project_id,t.id,l.link_role,l.sort_order,'worker_surface_split',coalesce(l.metadata,'{}'::jsonb),l.parent_task_id,now(),now()
from atlas.tasks t
join atlas.tasks s on s.id=(t.metadata->>'source_task_id')::uuid
join atlas.project_task_links l on l.task_id=s.id
where t.metadata->>'task_key' in (
  'anna_20260812_venue_lighting_conference_room','anna_20260812_venue_lighting_porch_solar',
  'anna_20260812_coffee_bar_start_cold_brew','anna_20260812_wrapping_station_stage_supplies'
)
  and not exists (select 1 from atlas.project_task_links x where x.project_id=l.project_id and x.task_id=t.id);

commit;
