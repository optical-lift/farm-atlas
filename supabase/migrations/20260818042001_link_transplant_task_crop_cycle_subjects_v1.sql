insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
select distinct
  t.id,
  cc.id,
  'affects',
  'confirmed',
  'spatial_destination_subject_link_repair_v1',
  jsonb_build_object('source','task_metadata_crop_cycle_ids','repaired_at',now())
from atlas.tasks t
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(coalesce(t.metadata,'{}'::jsonb)->'crop_cycle_ids')='array'
       then t.metadata->'crop_cycle_ids' else '[]'::jsonb end
) x(raw)
join atlas.crop_cycles cc
  on cc.id::text=x.raw
 and cc.farm_id=t.farm_id
where t.task_type in ('transplanting','production_transplant')
  and x.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict(task_id,crop_cycle_id,role) do nothing;

insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
select distinct
  t.id,
  cc.id,
  'affects',
  'confirmed',
  'spatial_destination_subject_link_repair_v1',
  jsonb_build_object('source','task_metadata_source_crop_cycle_id','repaired_at',now())
from atlas.tasks t
join atlas.crop_cycles cc
  on cc.id::text=t.metadata->>'source_crop_cycle_id'
 and cc.farm_id=t.farm_id
where t.task_type in ('transplanting','production_transplant')
  and coalesce(t.metadata->>'source_crop_cycle_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict(task_id,crop_cycle_id,role) do nothing;