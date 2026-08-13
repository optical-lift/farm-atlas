begin;

-- The first normalization pass intentionally collided with Atlas's central
-- release gate because generated work belongs in the reservoir. These exact
-- worker-surface correction specimens are not generated future work: they are
-- direct pieces of already-owned live execution. Cancel only the accidental
-- deferred occurrences that never released a task.
with correction_sources as (
  select id from atlas.tasks where metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
  union
  select id from atlas.tasks where title='Hang conference-room café lights + porch solar lights' and assigned_membership_id is not null
  union
  select id from atlas.tasks where metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping'
)
update atlas.planned_work_occurrences occurrence
set state='cancelled',
    metadata=coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
      'cancelled_by','worker_surface_direct_execution_reconcile_v1',
      'cancelled_reason','Correction specimen belongs inside an already-owned worker move, not the future release reservoir',
      'cancelled_at',now()
    ),
    updated_at=now()
where occurrence.source_kind in ('grouped_worker_move','worker_surface_split','station_checklist')
  and occurrence.released_task_id is null
  and (
    occurrence.source_id in (select id from correction_sources)
    or occurrence.source_id in (
      select id from atlas.tasks where metadata->>'task_key' in (
        'anna_20260812_coffee_bar_start_cold_brew',
        'anna_20260812_wrapping_station_stage_supplies'
      )
    )
  );

-- BW7 and BW8 are direct execution children of one visible sowing card. They
-- intentionally have no generated_from identity: the parent task already owns
-- release/calendar truth. Provenance lives in metadata instead.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,parent_task_id,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,
  work_lane,commitment_kind,operation_class,operation_class_source,task_scope,
  created_at,updated_at
)
select
  parent.farm_id,parent.organization_id,parent.zone_id,
  'Sow ProCut Horizon — BW7','sowing_bed','open',parent.priority,parent.due_date,
  jsonb_build_object(
    'task_key','owner_20260808_sow_procut_horizon_bw7',
    'source_task_id',parent.id,
    'source_kind','grouped_worker_move',
    'stateful_child',true,
    'worker_execution_child',true,
    'checklist_group_label','Beds',
    'checklist_label','BW7',
    'checklist_action_label','Mark sown',
    'display_action','Sow',
    'display_subject','BW7',
    'display_location',go.label,
    'planting_log_required',true,
    'planting_log_auto_capture',true,
    'planting_log_default_amount','1',
    'planting_log_unit','bed',
    'planting_log_default_zone_id',parent.zone_id::text,
    'planting_log_default_object_id',go.id::text,
    'planting_log_default_location',go.label,
    'planting_log_crop_label','Sunflower',
    'planting_log_variety','ProCut Horizon',
    'planting_method','direct_sow',
    'crop_profile_id',parent.metadata->>'crop_profile_id',
    'crop_profile_stable_key','sunflower_procut_horizon',
    'rows_per_3ft_bed',3,
    'in_row_spacing_in',4
  ),
  'sow','standard',parent.id,'assigned_worker',parent.assigned_membership_id,
  parent.assigned_user_id,parent.created_by_user_id,parent.origin_kind,
  parent.work_lane,parent.commitment_kind,coalesce(parent.operation_class,'establish_aboveground'),
  'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks parent
join atlas.growing_objects go on go.zone_id=parent.zone_id and go.stable_key='bw_7'
where parent.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
  and not exists (
    select 1 from atlas.tasks child
    where child.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7'
  );

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,parent_task_id,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,
  work_lane,commitment_kind,operation_class,operation_class_source,task_scope,
  created_at,updated_at
)
select
  parent.farm_id,parent.organization_id,parent.zone_id,
  'Sow ProCut Horizon — BW8','sowing_bed','open',parent.priority,parent.due_date,
  jsonb_build_object(
    'task_key','owner_20260808_sow_procut_horizon_bw8',
    'source_task_id',parent.id,
    'source_kind','grouped_worker_move',
    'stateful_child',true,
    'worker_execution_child',true,
    'checklist_group_label','Beds',
    'checklist_label','BW8',
    'checklist_action_label','Mark sown',
    'display_action','Sow',
    'display_subject','BW8',
    'display_location',go.label,
    'planting_log_required',true,
    'planting_log_auto_capture',true,
    'planting_log_default_amount','1',
    'planting_log_unit','bed',
    'planting_log_default_zone_id',parent.zone_id::text,
    'planting_log_default_object_id',go.id::text,
    'planting_log_default_location',go.label,
    'planting_log_crop_label','Sunflower',
    'planting_log_variety','ProCut Horizon',
    'planting_method','direct_sow',
    'crop_profile_id',parent.metadata->>'crop_profile_id',
    'crop_profile_stable_key','sunflower_procut_horizon',
    'rows_per_3ft_bed',3,
    'in_row_spacing_in',4
  ),
  'sow','standard',parent.id,'assigned_worker',parent.assigned_membership_id,
  parent.assigned_user_id,parent.created_by_user_id,parent.origin_kind,
  parent.work_lane,parent.commitment_kind,coalesce(parent.operation_class,'establish_aboveground'),
  'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks parent
join atlas.growing_objects go on go.zone_id=parent.zone_id and go.stable_key='bw_8'
where parent.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
  and not exists (
    select 1 from atlas.tasks child
    where child.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw8'
  );

insert into atlas.task_objects(task_id,object_id,role)
select child.id,go.id,'target'
from atlas.tasks child
join atlas.tasks parent on parent.id=child.parent_task_id
join atlas.growing_objects go on go.zone_id=parent.zone_id
where (child.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7' and go.stable_key='bw_7')
   or (child.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw8' and go.stable_key='bw_8')
on conflict (task_id,object_id) do nothing;

-- Split live Venue Lighting into its two physical moves. Use the archived source
-- task only as provenance; the target date comes from its last real transition.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,visibility_scope,assigned_membership_id,
  assigned_user_id,created_by_user_id,origin_kind,work_lane,commitment_kind,
  operation_class,operation_class_source,task_scope,created_at,updated_at
)
select source.farm_id,source.organization_id,source.zone_id,
  'Venue Lighting — Conference Room Café Lights','venue_lighting','open',source.priority,
  coalesce((source.metadata#>>'{last_transition,target_date}')::date,date '2026-08-12'),
  jsonb_build_object(
    'task_key','anna_20260812_venue_lighting_conference_room',
    'source_task_id',source.id,
    'source_kind','worker_surface_split',
    'display_family','Venue Lighting',
    'operation_family','Venue Lighting',
    'display_action','Hang',
    'display_subject','Café lights',
    'display_location','Conference room',
    'execution_place','Conference room',
    'execution_do','Hang café lights from ceiling hooks.',
    'window_key','evening',
    'work_order_anchor','evening'
  ),
  'hang','standard','assigned_worker',source.assigned_membership_id,source.assigned_user_id,
  source.created_by_user_id,source.origin_kind,source.work_lane,source.commitment_kind,
  null,'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks source
where source.title='Hang conference-room café lights + porch solar lights'
  and source.assigned_membership_id is not null
  and source.metadata ? 'superseded_by_task_keys'
  and not exists (
    select 1 from atlas.tasks task
    where task.metadata->>'task_key'='anna_20260812_venue_lighting_conference_room'
  )
order by source.updated_at desc
limit 1;

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,visibility_scope,assigned_membership_id,
  assigned_user_id,created_by_user_id,origin_kind,work_lane,commitment_kind,
  operation_class,operation_class_source,task_scope,created_at,updated_at
)
select source.farm_id,source.organization_id,source.zone_id,
  'Venue Lighting — Porch Solar Lights','venue_lighting','open',source.priority,
  coalesce((source.metadata#>>'{last_transition,target_date}')::date,date '2026-08-12'),
  jsonb_build_object(
    'task_key','anna_20260812_venue_lighting_porch_solar',
    'source_task_id',source.id,
    'source_kind','worker_surface_split',
    'display_family','Venue Lighting',
    'operation_family','Venue Lighting',
    'display_action','Place',
    'display_subject','Solar lights',
    'display_location','Porches',
    'execution_place','Porches',
    'execution_do','Place solar lights outside and position them to charge.',
    'window_key','evening',
    'work_order_anchor','evening'
  ),
  'place','standard','assigned_worker',source.assigned_membership_id,source.assigned_user_id,
  source.created_by_user_id,source.origin_kind,source.work_lane,source.commitment_kind,
  null,'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks source
where source.title='Hang conference-room café lights + porch solar lights'
  and source.assigned_membership_id is not null
  and source.metadata ? 'superseded_by_task_keys'
  and not exists (
    select 1 from atlas.tasks task
    where task.metadata->>'task_key'='anna_20260812_venue_lighting_porch_solar'
  )
order by source.updated_at desc
limit 1;

-- Coffee Bar and Wrapping Station are direct moves cut out of one now-archived
-- live prep task. Their internal child rows are direct children, not reservoir work.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,visibility_scope,assigned_membership_id,
  assigned_user_id,created_by_user_id,origin_kind,work_lane,commitment_kind,
  operation_class,operation_class_source,task_scope,created_at,updated_at
)
select source.farm_id,source.organization_id,source.zone_id,
  'Coffee Bar — Start Cold Brew','hospitality_prep','open',source.priority,date '2026-08-12',
  jsonb_build_object(
    'task_key','anna_20260812_coffee_bar_start_cold_brew',
    'source_task_id',source.id,
    'source_kind','worker_surface_split',
    'display_family','Coffee Bar',
    'operation_family','Coffee Bar',
    'display_action','Prepare',
    'display_subject','Cold brew',
    'display_location','Coffee Bar',
    'execution_place','Coffee Bar',
    'execution_do','Start the cold brew for Thursday.',
    'operation_place_key','coffee_bar',
    'place_readiness_on_done',true,
    'window_key','evening',
    'work_order_anchor','evening'
  ),
  'prepare','standard','assigned_worker',source.assigned_membership_id,source.assigned_user_id,
  source.created_by_user_id,source.origin_kind,source.work_lane,source.commitment_kind,
  null,'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks source
where source.metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping'
  and not exists (
    select 1 from atlas.tasks task
    where task.metadata->>'task_key'='anna_20260812_coffee_bar_start_cold_brew'
  )
order by source.updated_at desc
limit 1;

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,visibility_scope,assigned_membership_id,
  assigned_user_id,created_by_user_id,origin_kind,work_lane,commitment_kind,
  operation_class,operation_class_source,task_scope,created_at,updated_at
)
select source.farm_id,source.organization_id,source.zone_id,
  'Wrapping Station — Stage Thursday Supplies','fulfillment_prep','open',source.priority,date '2026-08-12',
  jsonb_build_object(
    'task_key','anna_20260812_wrapping_station_stage_supplies',
    'source_task_id',source.id,
    'source_kind','worker_surface_split',
    'display_family','Wrapping Station',
    'operation_family','Wrapping Station',
    'display_action','Stage',
    'display_subject','Thursday wrapping supplies',
    'display_location','Wrapping station',
    'execution_place','Wrapping station',
    'execution_do','Stage the wrapping station for Thursday.',
    'operation_place_key','bouquet_wrapping_station',
    'place_readiness_on_done',true,
    'window_key','evening',
    'work_order_anchor','evening'
  ),
  'stage','standard','assigned_worker',source.assigned_membership_id,source.assigned_user_id,
  source.created_by_user_id,source.origin_kind,source.work_lane,source.commitment_kind,
  null,'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks source
where source.metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping'
  and not exists (
    select 1 from atlas.tasks task
    where task.metadata->>'task_key'='anna_20260812_wrapping_station_stage_supplies'
  )
order by source.updated_at desc
limit 1;

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,parent_task_id,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,
  work_lane,commitment_kind,operation_class,operation_class_source,task_scope,
  created_at,updated_at
)
select parent.farm_id,parent.organization_id,parent.zone_id,step.title,'checklist_step','open',
  parent.priority,parent.due_date,
  jsonb_build_object(
    'task_key',step.task_key,
    'source_task_id',parent.id,
    'source_kind','station_checklist',
    'stateful_child',true,
    'worker_execution_child',true,
    'checklist_group_label','Cold brew',
    'checklist_label',step.label,
    'checklist_action_label','Mark complete'
  ),
  'check','light',parent.id,'assigned_worker',parent.assigned_membership_id,parent.assigned_user_id,
  parent.created_by_user_id,parent.origin_kind,parent.work_lane,parent.commitment_kind,
  null,'worker_surface_grammar_v1','farm_operation',now(),now()
from atlas.tasks parent
cross join lateral (values
  ('Coffee Bar — Add coffee + water','anna_20260812_coffee_bar_step_mix','2 cups grounds + 6 cups cold water'),
  ('Coffee Bar — Stir','anna_20260812_coffee_bar_step_stir','Stir until all grounds are wet'),
  ('Coffee Bar — Refrigerate','anna_20260812_coffee_bar_step_chill','Cover + refrigerate 12–16 hr')
) as step(title,task_key,label)
where parent.metadata->>'task_key'='anna_20260812_coffee_bar_start_cold_brew'
  and not exists (
    select 1 from atlas.tasks child where child.metadata->>'task_key'=step.task_key
  );

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  metadata,action_key,work_class,parent_task_id,visibility_scope,
  assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,
  work_lane,commitment_kind,operation_class,operation_class_source,task_scope,
  created_at,updated_at
)
select parent.farm_id,parent.organization_id,parent.zone_id,step.title,'checklist_step','open',
  parent.priority,parent.due_date,
  jsonb_build_object(
    'task_key',step.task_key,
    'source_task_id',parent.id,
    'source_kind','station_checklist',
    'stateful_child',true,
    'worker_execution_child',true,
    'checklist_group_label','Station',
    'checklist_label',step.label,
    'checklist_action_label','Mark staged'
  ),
  'stage','light',parent.id,'assigned_worker',parent.assigned_membership_id,parent.assigned_user_id,
  parent.created_by_user_id,parent.origin_kind,parent.work_lane,parent.commitment_kind,
  null,'worker_surface_grammar_v1','farm_operation',now(),now()
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
  and not exists (
    select 1 from atlas.tasks child where child.metadata->>'task_key'=step.task_key
  );

-- Preserve project membership without making generated_from carry release meaning.
insert into atlas.project_task_links(project_id,task_id,link_role,sort_order,source,metadata,parent_task_id,created_at,updated_at)
select source_link.project_id,target.id,source_link.link_role,source_link.sort_order,
  'worker_surface_split',coalesce(source_link.metadata,'{}'::jsonb),source_link.parent_task_id,now(),now()
from atlas.tasks target
join atlas.tasks source on source.id=(target.metadata->>'source_task_id')::uuid
join atlas.project_task_links source_link on source_link.task_id=source.id
where target.metadata->>'task_key' in (
    'anna_20260812_venue_lighting_conference_room',
    'anna_20260812_venue_lighting_porch_solar',
    'anna_20260812_coffee_bar_start_cold_brew',
    'anna_20260812_wrapping_station_stage_supplies'
  )
  and not exists (
    select 1 from atlas.project_task_links existing
    where existing.project_id=source_link.project_id and existing.task_id=target.id
  );

commit;
