-- Record Marshall's report that BB8 and BB9 were sown with ProCut Horizon on August 3.

begin;

do $migration$
declare
  v_farm_id uuid;
  v_zone_id uuid;
  v_owner_membership_id uuid;
  v_owner_user_id uuid;
  v_bb8_id uuid;
  v_bb9_id uuid;
  v_bb10_id uuid;
  v_bb8_cycle_id uuid;
  v_bb9_cycle_id uuid;
  v_field_log_id uuid;
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm';
  select id into v_zone_id from atlas.zones where farm_id=v_farm_id and stable_key='barn_beds';
  select id,user_id into v_owner_membership_id,v_owner_user_id
  from atlas.farm_memberships where farm_id=v_farm_id and worker_key='lex' and active limit 1;
  select id into v_bb8_id from atlas.growing_objects where farm_id=v_farm_id and stable_key='bb_8';
  select id into v_bb9_id from atlas.growing_objects where farm_id=v_farm_id and stable_key='bb_9';
  select id into v_bb10_id from atlas.growing_objects where farm_id=v_farm_id and stable_key='bb_10';

  select id into v_bb8_cycle_id from atlas.crop_cycles
  where farm_id=v_farm_id and object_id=v_bb8_id
    and crop_profile_id=(select id from atlas.crop_profiles where stable_key='sunflower_procut_horizon')
  order by created_at desc limit 1;
  select id into v_bb9_cycle_id from atlas.crop_cycles
  where farm_id=v_farm_id and object_id=v_bb9_id
    and crop_profile_id=(select id from atlas.crop_profiles where stable_key='sunflower_procut_horizon')
  order by created_at desc limit 1;

  if v_bb8_cycle_id is null or v_bb9_cycle_id is null then
    raise exception 'BB8 and BB9 ProCut Horizon cycles are required.';
  end if;

  insert into atlas.field_logs(
    farm_id,log_date,action_types,summary_sentence,note,created_by,source,
    metadata,actor_user_id,actor_membership_id,actor_role,idempotency_key
  ) values (
    v_farm_id,date '2026-08-03',array['sow']::text[],
    'ProCut Horizon was sown in Barn Beds 8 and 9.',
    'Marshall reported that BB8 and BB9 were sown the previous night. BB10 remained unsown because of Bermuda grass.',
    'owner','owner_instruction',
    jsonb_build_object('source','marshall_text_20260804','objects',jsonb_build_array('bb_8','bb_9')),
    v_owner_user_id,v_owner_membership_id,'owner',
    'owner:marshall-report:bb8-bb9-horizon-sown:2026-08-03'
  ) on conflict do nothing;

  select id into v_field_log_id from atlas.field_logs
  where farm_id=v_farm_id and idempotency_key='owner:marshall-report:bb8-bb9-horizon-sown:2026-08-03' limit 1;

  insert into atlas.field_log_objects(field_log_id,zone_id,object_id,role)
  select v_field_log_id,v_zone_id,v.object_id,'touched'
  from (values (v_bb8_id),(v_bb9_id)) as v(object_id)
  where not exists (
    select 1 from atlas.field_log_objects link
    where link.field_log_id=v_field_log_id and link.object_id=v.object_id
  );

  delete from atlas.crop_placements placement
  using atlas.crop_cycles cycle
  where placement.crop_cycle_id=cycle.id
    and cycle.object_id in (v_bb8_id,v_bb9_id,v_bb10_id)
    and cycle.variety='Teddy' and cycle.sown_date is null;

  update atlas.crop_cycles
  set cycle_state='cancelled',lifecycle_status='archived',
      note='Superseded before sowing by the ProCut Horizon plan.',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'archivedAt',now(),'archivedReason','Superseded unsown Teddy plan','replacementVariety','ProCut Horizon'
      ),updated_at=now()
  where object_id in (v_bb8_id,v_bb9_id,v_bb10_id)
    and variety='Teddy' and sown_date is null;

  update atlas.crop_cycles
  set cycle_state='sown',lifecycle_status='active',
      sown_date=date '2026-08-03',planted_date=date '2026-08-03',
      expected_germination_start=date '2026-08-07',expected_germination_end=date '2026-08-13',
      expected_harvest_watch_start=date '2026-09-22',expected_harvest_watch_end=date '2026-10-02',
      expected_clear_date=date '2026-10-07',
      note='Sown August 3, 2026; reported by Marshall on August 4.',
      metadata=(coalesce(metadata,'{}'::jsonb)-'readiness_blocked'-'readiness_blocked_until'-'readiness_blocked_reason')
        ||jsonb_build_object('actual_sow_date','2026-08-03','actual_sow_source','marshall_text_20260804','physical_truth_recorded_at',now()),
      updated_at=now()
  where id in (v_bb8_cycle_id,v_bb9_cycle_id);

  update atlas.crop_placements
  set placement_mode='full_rows',row_count=3,row_length_ft=18,area_sqft=54,
      spacing_in=4,expected_quantity=162,expected_quantity_kind='calculated',
      expected_quantity_unit='plants',expected_quantity_basis='3 rows × 18 feet ÷ 4-inch spacing',
      confidence='owner_confirmed',long_start_ft=0,long_end_ft=18,position_confidence='high',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('physicalTruthSource','marshall_text_20260804','coverage_kind','whole_object'),
      updated_at=now()
  where crop_cycle_id in (v_bb8_cycle_id,v_bb9_cycle_id);

  insert into atlas.object_activity_events(
    farm_id,object_id,event_type,event_date,note,created_by,source,metadata,field_log_id,crop_cycle_id,idempotency_key
  )
  select v_farm_id,v.object_id,'sown',date '2026-08-03',
         'ProCut Horizon sown in '||v.label||'.','owner','owner_instruction',
         jsonb_build_object('variety','ProCut Horizon','reportedBy','Marshall'),
         v_field_log_id,v.cycle_id,v.idempotency_key
  from (values
    (v_bb8_id,v_bb8_cycle_id,'Barn Bed 8','owner:bb8:procut-horizon:sown:2026-08-03'),
    (v_bb9_id,v_bb9_cycle_id,'Barn Bed 9','owner:bb9:procut-horizon:sown:2026-08-03')
  ) as v(object_id,cycle_id,label,idempotency_key)
  where not exists (select 1 from atlas.object_activity_events e where e.idempotency_key=v.idempotency_key);

  insert into atlas.crop_observations(
    farm_id,object_id,crop_cycle_id,field_log_id,observed_date,stage,condition,
    confidence,source_kind,source_id,note,idempotency_key,metadata
  )
  select v_farm_id,v.object_id,v.cycle_id,v_field_log_id,date '2026-08-03','sown','newly_sown',
         'owner_confirmed','owner_report','marshall_text_20260804',
         'ProCut Horizon was sown the previous night.',v.idempotency_key,jsonb_build_object('reportedBy','Marshall')
  from (values
    (v_bb8_id,v_bb8_cycle_id,'owner:bb8:procut-horizon:observation:2026-08-03'),
    (v_bb9_id,v_bb9_cycle_id,'owner:bb9:procut-horizon:observation:2026-08-03')
  ) as v(object_id,cycle_id,idempotency_key)
  where not exists (select 1 from atlas.crop_observations o where o.idempotency_key=v.idempotency_key);

  update atlas.object_state
  set life_status='planted_no_emergence',last_touched_at=date '2026-08-03',last_checked_at=date '2026-08-04',
      decision_required=false,harvest_confidence='none',
      metadata=(coalesce(metadata,'{}'::jsonb)-'spray_hold_until'-'planned_sow_not_before'-'weed_control_status'-'management_decision')
        ||jsonb_build_object(
          'stand_status','recently_sown_no_germination_yet','active_crop_label','Sunflower',
          'active_crop_variety','ProCut Horizon','active_crop_sown_date','2026-08-03',
          'expected_germination_start','2026-08-07','expected_germination_end','2026-08-13',
          'expected_harvest_watch_start','2026-09-22','expected_harvest_watch_end','2026-10-02',
          'expected_clear_date','2026-10-07','physical_truth_source','marshall_text_20260804'
        ),updated_at=now()
  where object_id in (v_bb8_id,v_bb9_id);

  update atlas.growing_objects object
  set metadata=(coalesce(object.metadata,'{}'::jsonb)-'planned_crop')||jsonb_build_object(
        'active_crop_label','Sunflower','active_crop_variety','ProCut Horizon',
        'active_crop_profile_stable_key','sunflower_procut_horizon',
        'active_crop_cycle_id',case when object.id=v_bb8_id then v_bb8_cycle_id else v_bb9_cycle_id end,
        'active_crop_sown_date','2026-08-03','zone_registry_role','bed_with_active_crop_cycle'
      ),updated_at=now()
  where object.id in (v_bb8_id,v_bb9_id);

  perform atlas.sync_crop_cycle_registry_v1(v_farm_id,v_bb8_id);
  perform atlas.sync_crop_cycle_registry_v1(v_farm_id,v_bb9_id);
end;
$migration$;

commit;
