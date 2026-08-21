-- Canonicalize Barn Beds walkway care and retire the legacy weekly-harvest wording.
-- Stable-key recovery of production migration 20260821220837.

do $$
declare
  v_farm uuid;
  v_weed_task uuid;
  v_spray_task uuid;
  v_sow_task uuid;
begin
  select id into v_farm from atlas.farms where stable_key='elm_farm';

  select id into v_weed_task
  from atlas.tasks
  where farm_id=v_farm and metadata->>'task_key'='anna_20260825_weed_barn_beds_walkways_for_grass'
  order by created_at limit 1;

  select id into v_spray_task
  from atlas.tasks
  where farm_id=v_farm and metadata->>'task_key'='anna_20260818_spray_barn_beds_walkways_for_grass'
  order by created_at limit 1;

  select id into v_sow_task
  from atlas.tasks
  where farm_id=v_farm and metadata->>'task_key'='anna_20260901_sow_horse_pasture_grass_barn_beds_walkways'
  order by created_at limit 1;

  if v_weed_task is not null then
    update atlas.tasks
    set status='archived',
        visibility_scope='system_internal',
        completed_at=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'archived_reason','Barn Beds walkways are not hand-weeded; establish grass after spray and maintain by mowing.',
          'archived_by','barn_beds_and_harvest_truth_v1',
          'archived_at',now()
        ),
        updated_at=now()
    where id=v_weed_task;

    update atlas.planned_work_occurrences
    set state='cancelled',released_task_id=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'cancelledBy','barn_beds_and_harvest_truth_v1',
          'cancelledAt',now(),
          'cancelledReason','Barn Beds walkways are not hand-weeded.'
        ),
        updated_at=now()
    where released_task_id=v_weed_task
       or coalesce(task_payload->'metadata'->>'task_key','')='anna_20260825_weed_barn_beds_walkways_for_grass';
  end if;

  update atlas.maintenance_objects
  set active=false,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'care_strategy','mow_and_hold',
        'ordinary_weeding_forbidden',true,
        'updatedBy','barn_beds_and_harvest_truth_v1'
      ),
      updated_at=now()
  where farm_id=v_farm
    and object_id=(select id from atlas.growing_objects where farm_id=v_farm and stable_key='barn_beds_walkways' limit 1)
    and maintenance_type='weed';

  if v_sow_task is not null and v_spray_task is not null then
    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'prerequisite_task_id',v_spray_task,
          'care_path','spray -> horse pasture/orchard grass -> mow',
          'barn_beds_walkway_hand_weeding_forbidden',true
        ),
        updated_at=now()
    where id=v_sow_task;
  end if;
end $$;

update atlas.planned_work_occurrences
set title='Harvest Stems',
    task_payload=jsonb_set(coalesce(task_payload,'{}'::jsonb),'{title}',to_jsonb('Harvest Stems'::text),true),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('weeklyHarvestTitleNormalizedBy','barn_beds_and_harvest_truth_v1'),
    updated_at=now()
where farm_id=(select id from atlas.farms where stable_key='elm_farm')
  and occurrence_key like 'recurring:anna_harvest_thursday_weekly:%'
  and state in ('planned','eligible','failed','releasing');
