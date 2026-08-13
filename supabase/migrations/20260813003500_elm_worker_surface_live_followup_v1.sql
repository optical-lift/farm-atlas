begin;

-- The parent grouping owns one visible sowing card; these children own the real
-- per-bed state transition and crop-cycle capture.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,parent_task_id,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select
  parent.farm_id,parent.organization_id,parent.zone_id,
  'Sow ProCut Horizon — BW7','sowing_bed','open',parent.priority,parent.due_date,
  'grouped_worker_move',parent.id,
  jsonb_build_object(
    'task_key','owner_20260808_sow_procut_horizon_bw7',
    'stateful_child',true,'worker_execution_child',true,
    'checklist_group_label','Beds','checklist_label','BW7','checklist_action_label','Mark sown',
    'display_action','Sow','display_subject','BW7','display_location',go.label,
    'planting_log_required',true,'planting_log_auto_capture',true,
    'planting_log_default_amount','1','planting_log_unit','bed',
    'planting_log_default_zone_id',parent.zone_id::text,
    'planting_log_default_object_id',go.id::text,
    'planting_log_default_location',go.label,
    'planting_log_crop_label','Sunflower','planting_log_variety','ProCut Horizon',
    'planting_method','direct_sow','crop_profile_id',parent.metadata->>'crop_profile_id',
    'crop_profile_stable_key','sunflower_procut_horizon','rows_per_3ft_bed',3,'in_row_spacing_in',4
  ),
  'sow','standard',parent.id,'assigned_worker',parent.assigned_membership_id,parent.assigned_user_id,
  parent.created_by_user_id,parent.origin_kind,parent.work_lane,parent.commitment_kind,
  coalesce(parent.operation_class,'establish_aboveground'),'worker_surface_grammar_v1',parent.task_scope,
  now(),'grouped_state_child',now(),now()
from atlas.tasks parent
join atlas.growing_objects go on go.zone_id=parent.zone_id and go.stable_key='bw_7'
where parent.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
  and not exists (select 1 from atlas.tasks c where c.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7');

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,parent_task_id,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select
  parent.farm_id,parent.organization_id,parent.zone_id,
  'Sow ProCut Horizon — BW8','sowing_bed','open',parent.priority,parent.due_date,
  'grouped_worker_move',parent.id,
  jsonb_build_object(
    'task_key','owner_20260808_sow_procut_horizon_bw8',
    'stateful_child',true,'worker_execution_child',true,
    'checklist_group_label','Beds','checklist_label','BW8','checklist_action_label','Mark sown',
    'display_action','Sow','display_subject','BW8','display_location',go.label,
    'planting_log_required',true,'planting_log_auto_capture',true,
    'planting_log_default_amount','1','planting_log_unit','bed',
    'planting_log_default_zone_id',parent.zone_id::text,
    'planting_log_default_object_id',go.id::text,
    'planting_log_default_location',go.label,
    'planting_log_crop_label','Sunflower','planting_log_variety','ProCut Horizon',
    'planting_method','direct_sow','crop_profile_id',parent.metadata->>'crop_profile_id',
    'crop_profile_stable_key','sunflower_procut_horizon','rows_per_3ft_bed',3,'in_row_spacing_in',4
  ),
  'sow','standard',parent.id,'assigned_worker',parent.assigned_membership_id,parent.assigned_user_id,
  parent.created_by_user_id,parent.origin_kind,parent.work_lane,parent.commitment_kind,
  coalesce(parent.operation_class,'establish_aboveground'),'worker_surface_grammar_v1',parent.task_scope,
  now(),'grouped_state_child',now(),now()
from atlas.tasks parent
join atlas.growing_objects go on go.zone_id=parent.zone_id and go.stable_key='bw_8'
where parent.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
  and not exists (select 1 from atlas.tasks c where c.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw8');

insert into atlas.task_objects(task_id,object_id,role)
select child.id,go.id,'target'
from atlas.tasks child
join atlas.tasks parent on parent.id=child.parent_task_id
join atlas.growing_objects go on go.zone_id=parent.zone_id
where (child.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7' and go.stable_key='bw_7')
   or (child.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw8' and go.stable_key='bw_8')
on conflict (task_id,object_id) do nothing;

-- Use the actual live combined lighting record as provenance even though the
-- superseding migration already archived it. Its last transition preserves Aug 12.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,work_lane,
  commitment_kind,operation_class,operation_class_source,task_scope,released_at,
  release_reason,created_at,updated_at
)
select old.farm_id,old.organization_id,old.zone_id,
  'Venue Lighting — Conference Room Café Lights','venue_lighting','open',old.priority,
  coalesce((old.metadata#>>'{last_transition,target_date}')::date,(old.metadata->>'execution_date')::date,date '2026-08-12'),
  'worker_surface_split',old.id,jsonb_build_object(
    'task_key','anna_20260812_venue_lighting_conference_room',
    'display_family','Venue Lighting','operation_family','Venue Lighting','display_action','Hang',
    'display_subject','Café lights','display_location','Conference room','execution_place','Conference room',
    'execution_do','Hang café lights from ceiling hooks.','window_key','evening','work_order_anchor','evening'
  ),'hang','standard','assigned_worker',old.assigned_membership_id,old.assigned_user_id,
  old.created_by_user_id,old.origin_kind,old.work_lane,old.commitment_kind,
  'host_prepare','worker_surface_grammar_v1','farm_operation',now(),'split_real_operation',now(),now()
from atlas.tasks old
where old.title='Hang conference-room café lights + porch solar lights'
  and old.assigned_membership_id is not null
  and not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_venue_lighting_conference_room')
order by old.updated_at desc
limit 1;

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,work_lane,
  commitment_kind,operation_class,operation_class_source,task_scope,released_at,
  release_reason,created_at,updated_at
)
select old.farm_id,old.organization_id,old.zone_id,
  'Venue Lighting — Porch Solar Lights','venue_lighting','open',old.priority,
  coalesce((old.metadata#>>'{last_transition,target_date}')::date,(old.metadata->>'execution_date')::date,date '2026-08-12'),
  'worker_surface_split',old.id,jsonb_build_object(
    'task_key','anna_20260812_venue_lighting_porch_solar',
    'display_family','Venue Lighting','operation_family','Venue Lighting','display_action','Place',
    'display_subject','Solar lights','display_location','Porches','execution_place','Porches',
    'execution_do','Place solar lights outside and position them to charge.','window_key','evening','work_order_anchor','evening'
  ),'place','standard','assigned_worker',old.assigned_membership_id,old.assigned_user_id,
  old.created_by_user_id,old.origin_kind,old.work_lane,old.commitment_kind,
  'host_prepare','worker_surface_grammar_v1','farm_operation',now(),'split_real_operation',now(),now()
from atlas.tasks old
where old.title='Hang conference-room café lights + porch solar lights'
  and old.assigned_membership_id is not null
  and not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_venue_lighting_porch_solar')
order by old.updated_at desc
limit 1;

insert into atlas.project_task_links(project_id,task_id,link_role,sort_order,source,metadata,parent_task_id,created_at,updated_at)
select ptl.project_id,new_task.id,ptl.link_role,ptl.sort_order,'worker_surface_split',coalesce(ptl.metadata,'{}'::jsonb),ptl.parent_task_id,now(),now()
from atlas.tasks old
join atlas.project_task_links ptl on ptl.task_id=old.id
join atlas.tasks new_task on new_task.generated_from_id=old.id
  and new_task.metadata->>'task_key' in ('anna_20260812_venue_lighting_conference_room','anna_20260812_venue_lighting_porch_solar')
where old.title='Hang conference-room café lights + porch solar lights'
  and not exists (select 1 from atlas.project_task_links x where x.project_id=ptl.project_id and x.task_id=new_task.id);

-- The live combined hospitality task used this key; split it into its two stations.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,work_lane,
  commitment_kind,operation_class,operation_class_source,task_scope,released_at,
  release_reason,created_at,updated_at
)
select old.farm_id,old.organization_id,old.zone_id,
  'Coffee Bar — Start Cold Brew','hospitality_prep','open',old.priority,old.due_date,
  'worker_surface_split',old.id,jsonb_build_object(
    'task_key','anna_20260812_coffee_bar_start_cold_brew','display_family','Coffee Bar','operation_family','Coffee Bar',
    'display_action','Prepare','display_subject','Cold brew','display_location','Coffee Bar','execution_place','Coffee Bar',
    'execution_do','Start the cold brew for Thursday.','operation_place_key','coffee_bar','place_readiness_on_done',true,
    'window_key','evening','work_order_anchor','evening'
  ),'prepare','standard','assigned_worker',old.assigned_membership_id,old.assigned_user_id,
  old.created_by_user_id,old.origin_kind,old.work_lane,old.commitment_kind,
  'host_prepare','worker_surface_grammar_v1','farm_operation',now(),'split_real_operation',now(),now()
from atlas.tasks old
where old.metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping'
  and old.status in ('open','blocked')
  and not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_coffee_bar_start_cold_brew');

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,work_lane,
  commitment_kind,operation_class,operation_class_source,task_scope,released_at,
  release_reason,created_at,updated_at
)
select old.farm_id,old.organization_id,old.zone_id,
  'Wrapping Station — Stage Thursday Supplies','fulfillment_prep','open',old.priority,old.due_date,
  'worker_surface_split',old.id,jsonb_build_object(
    'task_key','anna_20260812_wrapping_station_stage_supplies','display_family','Wrapping Station','operation_family','Wrapping Station',
    'display_action','Stage','display_subject','Thursday wrapping supplies','display_location','Wrapping station','execution_place','Wrapping station',
    'execution_do','Stage the wrapping station for Thursday.','operation_place_key','bouquet_wrapping_station','place_readiness_on_done',true,
    'window_key','evening','work_order_anchor','evening'
  ),'stage','standard','assigned_worker',old.assigned_membership_id,old.assigned_user_id,
  old.created_by_user_id,old.origin_kind,old.work_lane,old.commitment_kind,
  'fulfill_prepare','worker_surface_grammar_v1','farm_operation',now(),'split_real_operation',now(),now()
from atlas.tasks old
where old.metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping'
  and old.status in ('open','blocked')
  and not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_wrapping_station_stage_supplies');

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,parent_task_id,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select parent.farm_id,parent.organization_id,parent.zone_id,step.title,'checklist_step','open',parent.priority,parent.due_date,
  'station_checklist',parent.id,jsonb_build_object(
    'task_key',step.task_key,'stateful_child',true,'worker_execution_child',true,
    'checklist_group_label','Cold brew','checklist_label',step.label,'checklist_action_label','Mark complete'
  ),'check','light',parent.id,'assigned_worker',parent.assigned_membership_id,parent.assigned_user_id,
  parent.created_by_user_id,parent.origin_kind,parent.work_lane,parent.commitment_kind,
  'host_prepare','worker_surface_grammar_v1','farm_operation',now(),'station_checklist',now(),now()
from atlas.tasks parent
cross join lateral (values
  ('Coffee Bar — Add coffee + water','anna_20260812_coffee_bar_step_mix','2 cups grounds + 6 cups cold water'),
  ('Coffee Bar — Stir','anna_20260812_coffee_bar_step_stir','Stir until all grounds are wet'),
  ('Coffee Bar — Refrigerate','anna_20260812_coffee_bar_step_chill','Cover + refrigerate 12–16 hr')
) as step(title,task_key,label)
where parent.metadata->>'task_key'='anna_20260812_coffee_bar_start_cold_brew'
  and not exists (select 1 from atlas.tasks c where c.metadata->>'task_key'=step.task_key);

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,parent_task_id,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select parent.farm_id,parent.organization_id,parent.zone_id,step.title,'checklist_step','open',parent.priority,parent.due_date,
  'station_checklist',parent.id,jsonb_build_object(
    'task_key',step.task_key,'stateful_child',true,'worker_execution_child',true,
    'checklist_group_label','Station','checklist_label',step.label,'checklist_action_label','Mark staged'
  ),'stage','light',parent.id,'assigned_worker',parent.assigned_membership_id,parent.assigned_user_id,
  parent.created_by_user_id,parent.origin_kind,parent.work_lane,parent.commitment_kind,
  'fulfill_prepare','worker_surface_grammar_v1','farm_operation',now(),'station_checklist',now(),now()
from atlas.tasks parent
cross join lateral (values
  ('Wrapping Station — Brown paper','anna_20260812_wrapping_step_paper','Brown paper rectangles'),
  ('Wrapping Station — Stamp','anna_20260812_wrapping_step_stamp','Elm stamp + ink pad'),
  ('Wrapping Station — Rubber bands','anna_20260812_wrapping_step_bands','Green rubber bands'),
  ('Wrapping Station — Flower food','anna_20260812_wrapping_step_food','Flower food packets'),
  ('Wrapping Station — Sharpie','anna_20260812_wrapping_step_sharpie','Black Sharpie'),
  ('Wrapping Station — Stickers','anna_20260812_wrapping_step_stickers','Elm stickers')
) as step(title,task_key,label)
where parent.metadata->>'task_key'='anna_20260812_wrapping_station_stage_supplies'
  and not exists (select 1 from atlas.tasks c where c.metadata->>'task_key'=step.task_key);

insert into atlas.project_task_links(project_id,task_id,link_role,sort_order,source,metadata,parent_task_id,created_at,updated_at)
select ptl.project_id,new_task.id,ptl.link_role,ptl.sort_order,'worker_surface_split',coalesce(ptl.metadata,'{}'::jsonb),ptl.parent_task_id,now(),now()
from atlas.tasks old
join atlas.project_task_links ptl on ptl.task_id=old.id
join atlas.tasks new_task on new_task.generated_from_id=old.id
  and new_task.metadata->>'task_key' in ('anna_20260812_coffee_bar_start_cold_brew','anna_20260812_wrapping_station_stage_supplies')
where old.metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping'
  and not exists (select 1 from atlas.project_task_links x where x.project_id=ptl.project_id and x.task_id=new_task.id);

update atlas.tasks
set status='archived',due_date=null,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'archived_reason','Split into Coffee Bar and Wrapping Station operations',
      'superseded_by_task_keys',jsonb_build_array('anna_20260812_coffee_bar_start_cold_brew','anna_20260812_wrapping_station_stage_supplies'),
      'archived_at',now()
    ),updated_at=now()
where metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping'
  and status in ('open','blocked');

commit;
