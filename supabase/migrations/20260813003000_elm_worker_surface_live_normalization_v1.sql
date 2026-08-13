begin;

-- Snow in Summer is four 200-cell trays. The 180-cell soil blocker is a
-- separate tool and must never be substituted for the pot-up container truth.
with snow as (
  select id
  from atlas.tasks
  where metadata->>'task_key'='owner_20260812_snow_in_summer_one_move_v1'
     or (title='Pot up · Snow in Summer' and status='open')
  order by updated_at desc
  limit 1
)
update atlas.task_resource_requirements r
set quantity_needed=4,
    unit='trays',
    note=null,
    updated_at=now()
from snow s, atlas.resources res
where r.task_id=s.id
  and r.resource_id=res.id
  and res.stable_key='pot_up_tray_200_cell';

with snow as (
  select id
  from atlas.tasks
  where metadata->>'task_key'='owner_20260812_snow_in_summer_one_move_v1'
     or (title='Pot up · Snow in Summer' and status='open')
  order by updated_at desc
  limit 1
)
delete from atlas.task_resource_requirements r
using snow s, atlas.resources res
where r.task_id=s.id
  and r.resource_id=res.id
  and res.stable_key='pot_up_tray_120_cell';

update atlas.tasks
set metadata=(coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'container_count',4,
        'container_kind','200-cell plug tray',
        'execution_do','Pot up 720 plants → 4 trays',
        'execution_how',jsonb_build_array('Clean the potting area.','Put away potting supplies.'),
        'execution_how_label','After potting',
        'display_action','Pot up',
        'display_subject','Snow in Summer'
      )) - 'execution_done_when',
    updated_at=now()
where id=(
  select id from atlas.tasks
  where metadata->>'task_key'='owner_20260812_snow_in_summer_one_move_v1'
     or (title='Pot up · Snow in Summer' and status='open')
  order by updated_at desc limit 1
);

-- Horizon remains one worker card, but BW7 and BW8 are separate canonical
-- planting containers so one bed can enter its crop cycle without fabricating
-- the other bed's state.
update atlas.tasks
set metadata=(coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'display_action','Sow',
        'display_subject','ProCut Horizon · BW7 + BW8',
        'execution_do','Sow BW7 + BW8',
        'execution_how',jsonb_build_array('3 rows / bed','4″ spacing'),
        'execution_how_label','Layout',
        'grouped_state_children',true
      )) - 'execution_done_when',
    updated_at=now()
where metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8';

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,parent_task_id,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select
  parent.farm_id,parent.organization_id,parent.zone_id,
  'Sow ProCut Horizon — BW7', 'sowing_bed','open',parent.priority,parent.due_date,
  'grouped_worker_move',parent.id,
  jsonb_build_object(
    'task_key','owner_20260808_sow_procut_horizon_bw7',
    'stateful_child',true,
    'checklist_label','BW7',
    'checklist_group_label','Beds',
    'checklist_action_label','Mark sown',
    'display_action','Sow',
    'display_subject','BW7',
    'display_location','Berry Walk Bed 7',
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
    'in_row_spacing_in',4,
    'worker_execution_child',true
  ),
  'sow','standard',parent.id,'assigned_worker',parent.assigned_membership_id,
  parent.assigned_user_id,parent.created_by_user_id,'system',parent.work_lane,
  parent.commitment_kind,'establish','worker_surface_grammar_v1',parent.task_scope,
  now(),'grouped_state_child',now(),now()
from atlas.tasks parent
join atlas.growing_objects go on go.zone_id=parent.zone_id and go.stable_key='bw_7'
where parent.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
  and not exists (
    select 1 from atlas.tasks child
    where child.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7'
  );

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,parent_task_id,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select
  parent.farm_id,parent.organization_id,parent.zone_id,
  'Sow ProCut Horizon — BW8', 'sowing_bed','open',parent.priority,parent.due_date,
  'grouped_worker_move',parent.id,
  jsonb_build_object(
    'task_key','owner_20260808_sow_procut_horizon_bw8',
    'stateful_child',true,
    'checklist_label','BW8',
    'checklist_group_label','Beds',
    'checklist_action_label','Mark sown',
    'display_action','Sow',
    'display_subject','BW8',
    'display_location','Berry Walk Bed 8',
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
    'in_row_spacing_in',4,
    'worker_execution_child',true
  ),
  'sow','standard',parent.id,'assigned_worker',parent.assigned_membership_id,
  parent.assigned_user_id,parent.created_by_user_id,'system',parent.work_lane,
  parent.commitment_kind,'establish','worker_surface_grammar_v1',parent.task_scope,
  now(),'grouped_state_child',now(),now()
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

insert into atlas.task_objects(task_id,object_id,role)
select parent.id,go.id,'target'
from atlas.tasks parent
join atlas.growing_objects go on go.zone_id=parent.zone_id and go.stable_key in ('bw_7','bw_8')
where parent.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
on conflict (task_id,object_id) do nothing;

-- The weed card's farm action is already obvious. Keep only the useful physical
-- caution instead of exposing queue/process language to the worker.
update atlas.tasks
set metadata=(coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'display_action','Weed',
        'display_subject','MG11',
        'execution_do','Weed MG11.',
        'execution_how',jsonb_build_array('Hand weed carefully around the zinnias.'),
        'execution_how_label','Watch'
      )) - 'execution_done_when',
    updated_at=now()
where title='Weed MG11' and status in ('open','blocked');

-- Durable worker stations: these are places with reusable readiness, not event
-- prose containers.
insert into atlas.places(farm_id,stable_key,label,place_type,status,facts,sort_order,created_at,updated_at)
select f.id,'coffee_bar','Coffee Bar','work_station','active',
  jsonb_build_object(
    'readiness','needs_check',
    'components',jsonb_build_array('cold brew','milk','cups','water','carafes'),
    'operation_family','hospitality'
  ),210,now(),now()
from atlas.farms f
where f.stable_key='elm_farm'
on conflict (farm_id,stable_key) do update set
  label=excluded.label,place_type=excluded.place_type,status='active',
  facts=atlas.places.facts || excluded.facts,updated_at=now();

insert into atlas.places(farm_id,stable_key,label,place_type,status,facts,sort_order,created_at,updated_at)
select f.id,'bouquet_wrapping_station','Bouquet Wrapping Station','work_station','active',
  jsonb_build_object(
    'readiness','needs_check',
    'components',jsonb_build_array('brown paper','Elm stamp + ink','green rubber bands','flower food','black Sharpie','Elm stickers'),
    'operation_family','fulfillment'
  ),220,now(),now()
from atlas.farms f
where f.stable_key='elm_farm'
on conflict (farm_id,stable_key) do update set
  label=excluded.label,place_type=excluded.place_type,status='active',
  facts=atlas.places.facts || excluded.facts,updated_at=now();

-- Split venue lighting into the two physical operations Anna actually performs.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select old.farm_id,old.organization_id,old.zone_id,
  'Venue Lighting — Conference Room Café Lights','venue_lighting','open',old.priority,old.due_date,
  'worker_surface_split',old.id,
  jsonb_build_object(
    'task_key','anna_20260812_venue_lighting_conference_room',
    'display_family','Venue Lighting',
    'operation_family','Venue Lighting',
    'display_action','Hang',
    'display_subject','Café lights',
    'display_location','Conference room',
    'execution_place','Conference room',
    'execution_do','Hang café lights from ceiling hooks.',
    'window_key',coalesce(old.metadata->>'window_key','evening'),
    'work_order_anchor',coalesce(old.metadata->>'work_order_anchor','evening'),
    'project_id',old.metadata->>'project_id'
  ),
  'hang','standard','assigned_worker',old.assigned_membership_id,old.assigned_user_id,
  old.created_by_user_id,'owner_instruction',old.work_lane,old.commitment_kind,
  'host_prepare','worker_surface_grammar_v1',old.task_scope,now(),'split_real_operation',now(),now()
from atlas.tasks old
where old.title='Hang conference-room café lights + porch solar lights'
  and old.status in ('open','blocked')
  and not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_venue_lighting_conference_room');

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select old.farm_id,old.organization_id,old.zone_id,
  'Venue Lighting — Porch Solar Lights','venue_lighting','open',old.priority,old.due_date,
  'worker_surface_split',old.id,
  jsonb_build_object(
    'task_key','anna_20260812_venue_lighting_porch_solar',
    'display_family','Venue Lighting',
    'operation_family','Venue Lighting',
    'display_action','Place',
    'display_subject','Solar lights',
    'display_location','Porches',
    'execution_place','Porches',
    'execution_do','Place solar lights outside and position them to charge.',
    'window_key',coalesce(old.metadata->>'window_key','evening'),
    'work_order_anchor',coalesce(old.metadata->>'work_order_anchor','evening'),
    'project_id',old.metadata->>'project_id'
  ),
  'place','standard','assigned_worker',old.assigned_membership_id,old.assigned_user_id,
  old.created_by_user_id,'owner_instruction',old.work_lane,old.commitment_kind,
  'host_prepare','worker_surface_grammar_v1',old.task_scope,now(),'split_real_operation',now(),now()
from atlas.tasks old
where old.title='Hang conference-room café lights + porch solar lights'
  and old.status in ('open','blocked')
  and not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_venue_lighting_porch_solar');

insert into atlas.project_task_links(project_id,task_id,link_role,sort_order,source,metadata,parent_task_id,created_at,updated_at)
select ptl.project_id,new_task.id,ptl.link_role,ptl.sort_order,'worker_surface_split',
       coalesce(ptl.metadata,'{}'::jsonb),ptl.parent_task_id,now(),now()
from atlas.tasks old
join atlas.project_task_links ptl on ptl.task_id=old.id
join atlas.tasks new_task on new_task.metadata->>'task_key' in ('anna_20260812_venue_lighting_conference_room','anna_20260812_venue_lighting_porch_solar')
  and new_task.generated_from_id=old.id
where old.title='Hang conference-room café lights + porch solar lights'
  and not exists (
    select 1 from atlas.project_task_links existing
    where existing.project_id=ptl.project_id and existing.task_id=new_task.id
  );

update atlas.tasks
set status='archived',due_date=null,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'archived_reason','Split into conference-room and porch Venue Lighting operations',
      'superseded_by_task_keys',jsonb_build_array('anna_20260812_venue_lighting_conference_room','anna_20260812_venue_lighting_porch_solar'),
      'archived_at',now()
    ),updated_at=now()
where title='Hang conference-room café lights + porch solar lights'
  and status in ('open','blocked');

-- Split tonight's hospitality prep into the station that is being prepared.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select old.farm_id,old.organization_id,old.zone_id,
  'Coffee Bar — Start Cold Brew','hospitality_prep','open',old.priority,old.due_date,
  'worker_surface_split',old.id,
  jsonb_build_object(
    'task_key','anna_20260812_coffee_bar_start_cold_brew',
    'display_family','Coffee Bar',
    'operation_family','Coffee Bar',
    'display_action','Prepare',
    'display_subject','Cold brew',
    'display_location','Coffee Bar',
    'execution_place','Coffee Bar',
    'execution_do','Start the cold brew for Thursday.',
    'operation_place_key','coffee_bar',
    'place_readiness_on_done',true,
    'window_key','evening','work_order_anchor','evening'
  ),
  'prepare','standard','assigned_worker',old.assigned_membership_id,old.assigned_user_id,
  old.created_by_user_id,'owner_instruction',old.work_lane,old.commitment_kind,
  'host_prepare','worker_surface_grammar_v1',old.task_scope,now(),'split_real_operation',now(),now()
from atlas.tasks old
where old.metadata->>'task_key'='anna_20260812_prep_thursday_coffee_wrapping_supplies'
  and old.status in ('open','blocked')
  and not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_coffee_bar_start_cold_brew');

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select old.farm_id,old.organization_id,old.zone_id,
  'Wrapping Station — Stage Thursday Supplies','fulfillment_prep','open',old.priority,old.due_date,
  'worker_surface_split',old.id,
  jsonb_build_object(
    'task_key','anna_20260812_wrapping_station_stage_supplies',
    'display_family','Wrapping Station',
    'operation_family','Wrapping Station',
    'display_action','Stage',
    'display_subject','Thursday wrapping supplies',
    'display_location','Wrapping station',
    'execution_place','Wrapping station',
    'execution_do','Stage the wrapping station for Thursday.',
    'operation_place_key','bouquet_wrapping_station',
    'place_readiness_on_done',true,
    'window_key','evening','work_order_anchor','evening'
  ),
  'stage','standard','assigned_worker',old.assigned_membership_id,old.assigned_user_id,
  old.created_by_user_id,'owner_instruction',old.work_lane,old.commitment_kind,
  'fulfill_prepare','worker_surface_grammar_v1',old.task_scope,now(),'split_real_operation',now(),now()
from atlas.tasks old
where old.metadata->>'task_key'='anna_20260812_prep_thursday_coffee_wrapping_supplies'
  and old.status in ('open','blocked')
  and not exists (select 1 from atlas.tasks t where t.metadata->>'task_key'='anna_20260812_wrapping_station_stage_supplies');

-- Stateful visible checklist steps. They travel inside their station card instead
-- of becoming competing top-level tasks.
insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,parent_task_id,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select parent.farm_id,parent.organization_id,parent.zone_id,
  step.title,'checklist_step','open',parent.priority,parent.due_date,
  'station_checklist',parent.id,
  jsonb_build_object(
    'task_key',step.task_key,
    'stateful_child',true,
    'checklist_group_label',step.group_label,
    'checklist_label',step.label,
    'checklist_action_label','Mark complete',
    'worker_execution_child',true
  ),
  'check','light',parent.id,'assigned_worker',parent.assigned_membership_id,parent.assigned_user_id,
  parent.created_by_user_id,'system',parent.work_lane,parent.commitment_kind,
  'host_prepare','worker_surface_grammar_v1',parent.task_scope,now(),'station_checklist',now(),now()
from atlas.tasks parent
cross join lateral (values
  ('Coffee Bar — Add coffee + water','anna_20260812_coffee_bar_step_mix','Cold brew','2 cups grounds + 6 cups cold water'),
  ('Coffee Bar — Stir','anna_20260812_coffee_bar_step_stir','Cold brew','Stir until all grounds are wet'),
  ('Coffee Bar — Refrigerate','anna_20260812_coffee_bar_step_chill','Cold brew','Cover + refrigerate 12–16 hr')
) as step(title,task_key,group_label,label)
where parent.metadata->>'task_key'='anna_20260812_coffee_bar_start_cold_brew'
  and not exists (select 1 from atlas.tasks c where c.metadata->>'task_key'=step.task_key);

insert into atlas.tasks(
  farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,
  generated_from,generated_from_id,metadata,action_key,work_class,parent_task_id,
  visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,
  origin_kind,work_lane,commitment_kind,operation_class,operation_class_source,
  task_scope,released_at,release_reason,created_at,updated_at
)
select parent.farm_id,parent.organization_id,parent.zone_id,
  step.title,'checklist_step','open',parent.priority,parent.due_date,
  'station_checklist',parent.id,
  jsonb_build_object(
    'task_key',step.task_key,
    'stateful_child',true,
    'checklist_group_label','Station',
    'checklist_label',step.label,
    'checklist_action_label','Mark staged',
    'worker_execution_child',true
  ),
  'stage','light',parent.id,'assigned_worker',parent.assigned_membership_id,parent.assigned_user_id,
  parent.created_by_user_id,'system',parent.work_lane,parent.commitment_kind,
  'fulfill_prepare','worker_surface_grammar_v1',parent.task_scope,now(),'station_checklist',now(),now()
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
select ptl.project_id,new_task.id,ptl.link_role,ptl.sort_order,'worker_surface_split',
       coalesce(ptl.metadata,'{}'::jsonb),ptl.parent_task_id,now(),now()
from atlas.tasks old
join atlas.project_task_links ptl on ptl.task_id=old.id
join atlas.tasks new_task on new_task.metadata->>'task_key' in ('anna_20260812_coffee_bar_start_cold_brew','anna_20260812_wrapping_station_stage_supplies')
  and new_task.generated_from_id=old.id
where old.metadata->>'task_key'='anna_20260812_prep_thursday_coffee_wrapping_supplies'
  and not exists (
    select 1 from atlas.project_task_links existing
    where existing.project_id=ptl.project_id and existing.task_id=new_task.id
  );

update atlas.tasks
set status='archived',due_date=null,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'archived_reason','Split into Coffee Bar and Wrapping Station operations',
      'superseded_by_task_keys',jsonb_build_array('anna_20260812_coffee_bar_start_cold_brew','anna_20260812_wrapping_station_stage_supplies'),
      'archived_at',now()
    ),updated_at=now()
where metadata->>'task_key'='anna_20260812_prep_thursday_coffee_wrapping_supplies'
  and status in ('open','blocked');

-- Tomorrow's existing station tasks now update the durable station state too.
update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'display_family','Coffee Bar',
      'operation_family','Coffee Bar',
      'operation_place_key','coffee_bar',
      'place_readiness_on_done',true
    ),updated_at=now()
where title='Set up kitchen + coffee + water station' and status in ('open','blocked');

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'display_family','Wrapping Station',
      'operation_family','Wrapping Station',
      'operation_place_key','bouquet_wrapping_station',
      'place_readiness_on_done',true
    ),updated_at=now()
where title='Stock bouquet wrapping station' and status in ('open','blocked');

-- Walmart is an Errand with one standard time/place/list grammar.
update atlas.tasks
set task_type='farm_errand',action_key='errand',operation_class='supply_pickup',
    operation_class_source='worker_surface_grammar_v1',
    metadata=(coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'display_family','Errand',
        'operation_family','Errand',
        'display_action','Pick up',
        'display_subject','Walmart · Event pickup',
        'execution_place','Walmart · Marshfield',
        'execution_do','Pick up the order between 3:00–4:00 p.m.',
        'execution_how_label','Pick up',
        'execution_how',jsonb_build_array('Ice','Clear plastic cups','Wide-mouth pouring-spout lid'),
        'pickup_window_start','2026-08-13T15:00:00-05:00',
        'pickup_window_end','2026-08-13T16:00:00-05:00'
      )) - 'execution_done_when',
    updated_at=now()
where title='Pick up Walmart order — Marshfield' and status in ('open','blocked');

commit;
