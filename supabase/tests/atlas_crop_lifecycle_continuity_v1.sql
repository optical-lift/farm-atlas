begin;

do $proof$
declare
  v_count integer;
  v_text text;
begin
  select count(*)::integer into v_count
  from atlas.v_crop_lifecycle_contract_v1
  where crop_profile_stable_key='zinnia_cut_flower_generic';
  if v_count <> 19 then
    raise exception 'Expected 19 lifecycle stages for generic zinnia; found %.',v_count;
  end if;

  if not exists(
    select 1 from atlas.v_crop_lifecycle_contract_v1
    where crop_profile_stable_key='zinnia_cut_flower_generic'
      and stage_key='pinch'
      and disposition='required'
      and contract_source='profile_metadata'
      and timing_min_days=25
      and timing_max_days=32
  ) then
    raise exception 'Existing Zinnia pinch metadata was not preserved by lifecycle compiler.';
  end if;

  select count(*)::integer into v_count
  from atlas.crop_cycles cc
  join atlas.crop_profiles cp on cp.id=cc.crop_profile_id
  where cc.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
    and cc.lifecycle_status='active'
    and cc.crop_label='Zinnia transplants · Aug 8'
    and lower(coalesce(cc.variety,''))='zinnia'
    and cp.stable_key='zinnia_cut_flower_generic';
  if v_count <> 11 then
    raise exception 'Expected 11 exact Aug 8 zinnia cycles linked to generic profile; found %.',v_count;
  end if;

  select task_payload->>'note' into v_text
  from atlas.planned_work_occurrences
  where occurrence_key='legacy-task:40e14d01-faa1-4843-a2a6-4e96ef1805a6';
  if v_text not ilike '%Rocket%' or v_text ilike '%Madame Butterfly%' then
    raise exception 'Rocket 2027 sow occurrence still carries crossed crop identity: %',v_text;
  end if;

  select count(*)::integer into v_count
  from atlas.planned_work_occurrences
  where id=any(array[
    '414e097f-01b2-4005-81c2-c60ba84e4754'::uuid,
    'de14da78-854c-4c2f-b0e7-2c2806772100'::uuid,
    'b8902867-f771-46d2-932c-31311ba119ee'::uuid,
    '26e59efa-26c3-43d9-b9c8-32c6563c525e'::uuid,
    '10bd235c-39ea-418e-b719-e709901f064e'::uuid,
    'adb7e325-293c-4415-bff0-cc2ab8431d60'::uuid
  ]) and state='cancelled';
  if v_count <> 6 then
    raise exception 'Expected six superseded 2027 occurrences quarantined; found %.',v_count;
  end if;

  if exists(
    select 1
    from atlas.crop_cycles cc
    join atlas.growing_objects go on go.id=cc.object_id
    join atlas.v_crop_lifecycle_continuity_audit_v1 a on a.subject_kind='crop_cycle' and a.subject_id=cc.id
    where cc.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
      and cc.lifecycle_status='active'
      and go.object_type='seed_room'
      and cc.crop_label in ('Foxglove','Salvia','Yarrow')
      and ('next_operation_missing'=any(a.gap_types) or 'declared_next_action_unwired'=any(a.gap_types))
  ) then
    raise exception 'Known serial pot-up work is still being misclassified as missing.';
  end if;

  select count(*)::integer into v_count
  from atlas.crop_cycles cc
  join atlas.growing_objects go on go.id=cc.object_id
  join atlas.v_crop_lifecycle_continuity_audit_v1 a on a.subject_kind='crop_cycle' and a.subject_id=cc.id
  where cc.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
    and cc.lifecycle_status='active'
    and go.object_type='seed_room'
    and cc.crop_label in ('Creeping thyme','Echinacea','Feverfew','Foxglove','Salvia','Shasta daisy','Yarrow')
    and a.audit_status='dependency_pressure';
  if v_count < 10 then
    raise exception 'Expected current serial pot-up pressure to be surfaced; found only % crop cycles.',v_count;
  end if;

  select count(*)::integer into v_count
  from atlas.crop_cycles cc
  join atlas.growing_objects go on go.id=cc.object_id
  join atlas.v_crop_lifecycle_continuity_audit_v1 a on a.subject_kind='crop_cycle' and a.subject_id=cc.id
  where cc.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
    and cc.lifecycle_status='active'
    and go.object_type='seed_room'
    and cc.crop_label='Snapdragon'
    and a.audit_status='continuity_broken'
    and 'next_operation_missing'=any(a.gap_types);
  if v_count <> 4 then
    raise exception 'Expected four living overwinter snapdragon cohorts to remain genuine continuity breaks; found %.',v_count;
  end if;
end;
$proof$;

rollback;
