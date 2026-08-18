create index if not exists planned_work_occurrences_farm_state_source_idx
  on atlas.planned_work_occurrences(farm_id,state,source_kind,source_id)
  where state in ('planned','eligible','released');

create index if not exists planned_work_occurrences_farm_state_released_task_idx
  on atlas.planned_work_occurrences(farm_id,state,released_task_id)
  where state in ('planned','eligible','released') and released_task_id is not null;

create index if not exists tasks_farm_metadata_crop_cycle_id_idx
  on atlas.tasks(farm_id,(metadata->>'crop_cycle_id'))
  where metadata ? 'crop_cycle_id';

create index if not exists tasks_metadata_crop_cycle_ids_gin_idx
  on atlas.tasks using gin ((metadata->'crop_cycle_ids'))
  where metadata ? 'crop_cycle_ids';