update atlas.tasks
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
  'task_style','venue_reset',
  'venue_reset_version',1,
  'venue_reset_location_label','Detached Garage Face',
  'venue_reset_ready_label','Venue ready',
  'venue_reset_ready_result',coalesce(nullif(metadata->>'execution_done_when',''),'One garage face is gently cleaned.'),
  'venue_reset_resource_contract','task_resource_requirements_v1'
),
updated_at=now()
where metadata->>'task_key'='anna_20260811_gentle_pressure_wash_detached_garage_face';

insert into atlas.task_resource_requirements (
  task_id, resource_id, requirement_role, requirement_source,
  quantity_needed, unit, status, note, metadata, move_role
)
select
  t.id, r.id, 'required', 'manual',
  1, coalesce(nullif(r.unit,''),'washer'), 'available', null,
  jsonb_build_object('venue_reset_resource',true,'source','existing_task_instruction'),
  'equipment'
from atlas.tasks t
join atlas.resources r on r.farm_id=t.farm_id and r.stable_key='small_pressure_washer'
where t.metadata->>'task_key'='anna_20260811_gentle_pressure_wash_detached_garage_face'
  and not exists (
    select 1 from atlas.task_resource_requirements trr
    where trr.task_id=t.id and trr.resource_id=r.id and trr.requirement_role='required'
  );

update atlas.tasks
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
  'task_style','venue_reset',
  'venue_reset_version',1,
  'venue_reset_location_label','Farmhouse Exterior',
  'venue_reset_ready_label','Venue ready',
  'venue_reset_ready_result',coalesce(nullif(metadata->>'execution_done_when',''),'Both exterior house doors have the first purple coat.'),
  'venue_reset_resource_contract','task_resource_requirements_v1'
),
updated_at=now()
where metadata->>'task_key'='anna_20260727_two_house_doors_purple_first_coat';
