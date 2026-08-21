update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'care_path','spray -> orchard grass -> mow',
      'next_step_label','Sow orchard grass seed',
      'dependent_task_label','Sow Orchard Grass Seed in Barn Beds Walkways',
      'orchard_grass_handoff_corrected_at',now(),
      'orchard_grass_handoff_corrected_by','owner_instruction_20260821'
    ),
    updated_at=now()
where farm_id=(select id from atlas.farms where stable_key='elm_farm')
  and metadata->>'task_key'='anna_20260818_spray_barn_beds_walkways_for_grass';

update atlas.planned_work_occurrences
set task_payload=jsonb_set(
      coalesce(task_payload,'{}'::jsonb),
      '{metadata}',
      coalesce(task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
        'care_path','spray -> orchard grass -> mow',
        'next_step_label','Sow orchard grass seed',
        'dependent_task_label','Sow Orchard Grass Seed in Barn Beds Walkways',
        'orchard_grass_handoff_corrected_at',now(),
        'orchard_grass_handoff_corrected_by','owner_instruction_20260821'
      ),
      true
    ),
    updated_at=now()
where farm_id=(select id from atlas.farms where stable_key='elm_farm')
  and coalesce(task_payload->'metadata'->>'task_key','')='anna_20260818_spray_barn_beds_walkways_for_grass';
