update atlas.tasks
set metadata = metadata - 'work_collection_key' - 'work_collection_role' - 'canonical_collection_task',
    updated_at = now()
where status in ('open', 'blocked')
  and task_type = 'sowing'
  and action_key = 'sow'
  and coalesce((metadata ->> 'weed_rotation_excluded')::boolean, false) = true
  and metadata ->> 'work_collection_key' = 'weeding'
  and metadata ->> 'task_key' like 'entry_billboard_pollenless_2026_eb_sunflower_%';
