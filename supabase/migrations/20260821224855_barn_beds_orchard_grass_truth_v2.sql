update atlas.tasks
set title='Sow Orchard Grass Seed in Barn Beds Walkways',
    metadata=(coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'task_key','anna_20260901_sow_orchard_grass_barn_beds_walkways',
        'legacy_task_key','anna_20260901_sow_horse_pasture_grass_barn_beds_walkways',
        'planned_seed','orchard grass seed',
        'display_subject','Orchard grass seed',
        'care_path','spray -> orchard grass -> mow',
        'seed_truth_corrected_at',now(),
        'seed_truth_corrected_by','owner_instruction_20260821'
      )) - 'seed_alias_truth',
    updated_at=now()
where farm_id=(select id from atlas.farms where stable_key='elm_farm')
  and metadata->>'task_key'='anna_20260901_sow_horse_pasture_grass_barn_beds_walkways';

update atlas.planned_work_occurrences
set title='Sow Orchard Grass Seed in Barn Beds Walkways',
    task_payload=jsonb_set(
      jsonb_set(coalesce(task_payload,'{}'::jsonb),'{title}',to_jsonb('Sow Orchard Grass Seed in Barn Beds Walkways'::text),true),
      '{metadata}',
      ((coalesce(task_payload->'metadata','{}'::jsonb)
        || jsonb_build_object(
          'task_key','anna_20260901_sow_orchard_grass_barn_beds_walkways',
          'legacy_task_key','anna_20260901_sow_horse_pasture_grass_barn_beds_walkways',
          'planned_seed','orchard grass seed',
          'display_subject','Orchard grass seed',
          'care_path','spray -> orchard grass -> mow',
          'seed_truth_corrected_at',now(),
          'seed_truth_corrected_by','owner_instruction_20260821'
        )) - 'seed_alias_truth'),
      true
    ),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('orchardGrassTruthV2',true,'correctedAt',now()),
    updated_at=now()
where farm_id=(select id from atlas.farms where stable_key='elm_farm')
  and occurrence_key like 'manual:%:2026-09-01:%'
  and coalesce(task_payload->'metadata'->>'task_key','')='anna_20260901_sow_horse_pasture_grass_barn_beds_walkways';

update atlas.work_definitions wd
set title_template='Sow Orchard Grass Seed in Barn Beds Walkways',updated_at=now()
where wd.id in (
  select o.work_definition_id from atlas.planned_work_occurrences o
  where o.farm_id=(select id from atlas.farms where stable_key='elm_farm')
    and coalesce(o.task_payload->'metadata'->>'task_key','')='anna_20260901_sow_orchard_grass_barn_beds_walkways'
);
