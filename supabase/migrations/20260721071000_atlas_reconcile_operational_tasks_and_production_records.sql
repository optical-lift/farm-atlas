do $migration$
declare
  v_zinnia_mg10_cycle_id uuid;
  v_cosmos_fr1_content_id uuid;
begin
  update atlas.tasks
  set due_date = date '2026-07-23',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'due_date_reconciled_with_parent', true,
        'due_date_reconciled_at', now(),
        'due_date_reconciliation_source', 'atlas_operational_audit_20260721'
      ),
      updated_at = now()
  where id in (
    '74418fea-41af-4712-8efb-89341d5c2dba'::uuid,
    '9f5638d2-3606-4a5a-aa24-e48553fb2858'::uuid,
    '81246a90-41ef-4219-8969-c90b7b5b527c'::uuid
  )
    and parent_task_id = '6e44f4a6-a0f1-4061-b1c5-f63b1a233580'::uuid
    and status in ('open', 'blocked');

  insert into atlas.task_objects (task_id, object_id, role)
  values
    ('88b38876-76a4-43e0-b7c2-1ab7a4bf55fe'::uuid, 'bfa50918-9752-45ec-9ad1-086f90ed6465'::uuid, 'target'),
    ('88b38876-76a4-43e0-b7c2-1ab7a4bf55fe'::uuid, '481fd159-c243-48d2-b8b2-207c096edc16'::uuid, 'target'),
    ('88b38876-76a4-43e0-b7c2-1ab7a4bf55fe'::uuid, 'e8aa903d-60e3-4ad6-a256-0d0b6fb93085'::uuid, 'target'),
    ('de56736a-8293-4776-9999-859831d8918a'::uuid, 'ca56199d-4664-48ed-90a1-6c39c731909e'::uuid, 'target'),
    ('de56736a-8293-4776-9999-859831d8918a'::uuid, 'f9a53f24-4198-45b2-be02-e4a42964797a'::uuid, 'target'),
    ('de56736a-8293-4776-9999-859831d8918a'::uuid, '1244bec9-325d-4eab-a4ed-ec7f9427a91a'::uuid, 'target'),
    ('87034522-3ef6-41ae-b684-6c2991184eed'::uuid, 'e6560fd6-2583-48f9-930d-a4d61462228c'::uuid, 'target'),
    ('87034522-3ef6-41ae-b684-6c2991184eed'::uuid, '59973635-c66b-4d8a-8600-bbb9d59fe4c0'::uuid, 'target'),
    ('87034522-3ef6-41ae-b684-6c2991184eed'::uuid, '971ea1b8-5429-4ad6-b784-6d1647e7ebf1'::uuid, 'target')
  on conflict (task_id, object_id) do nothing;

  update atlas.tasks
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'object_links_reconciled_at', now(),
        'object_links_reconciliation_source', 'atlas_operational_audit_20260721'
      ),
      updated_at = now()
  where id in (
    '88b38876-76a4-43e0-b7c2-1ab7a4bf55fe'::uuid,
    'de56736a-8293-4776-9999-859831d8918a'::uuid,
    '87034522-3ef6-41ae-b684-6c2991184eed'::uuid
  );

  update atlas.production_successions
  set planned_window_start = date '2026-07-27',
      planned_window_end = planned_window_end + (date '2026-07-27' - planned_window_start),
      late_window_end = late_window_end + (date '2026-07-27' - planned_window_start),
      skip_after_date = skip_after_date + (date '2026-07-27' - planned_window_start),
      projected_germination_start = projected_germination_start + (date '2026-07-27' - planned_window_start),
      projected_germination_end = projected_germination_end + (date '2026-07-27' - planned_window_start),
      projected_harvest_start = projected_harvest_start + (date '2026-07-27' - planned_window_start),
      projected_harvest_end = projected_harvest_end + (date '2026-07-27' - planned_window_start),
      projected_clear_date = projected_clear_date + (date '2026-07-27' - planned_window_start),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'window_reconciled_to_task_due_date', true,
        'window_reconciled_at', now(),
        'window_reconciliation_reason', 'BB8-BB11 sprayed July 20; seven-day wait before sowing'
      ),
      updated_at = now()
  where id = '19c56e1e-6cd4-45a2-9a44-b20a4c13b424'::uuid
    and planned_window_start <> date '2026-07-27';

  update atlas.crop_cycles
  set crop_cycle_key = replace(crop_cycle_key, '2026_0722', '2026_0727'),
      expected_germination_start = expected_germination_start + 5,
      expected_germination_end = expected_germination_end + 5,
      expected_harvest_watch_start = expected_harvest_watch_start + 5,
      expected_harvest_watch_end = expected_harvest_watch_end + 5,
      expected_clear_date = expected_clear_date + 5,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'planned_sow_date', date '2026-07-27',
        'planned_date_reconciled_at', now(),
        'planned_date_reconciliation_reason', 'BB8-BB11 post-spray waiting interval'
      ),
      updated_at = now()
  where id in (
    'afe69880-9562-4be6-b793-61281a18e6b8'::uuid,
    'a4539792-bed6-4820-918e-b847fc1ed0de'::uuid,
    'e42dc8e6-c6de-4158-af5e-26984a81003b'::uuid,
    'b22d2042-574d-4bb2-b9e3-34d51b3c0fed'::uuid
  )
    and metadata->>'planned_sow_date' = '2026-07-22';

  update atlas.production_successions
  set crop_cycle_id = 'aac801c4-766a-4d17-b2a3-d642d943b312'::uuid,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'crop_cycle_ids', jsonb_build_array('aac801c4-766a-4d17-b2a3-d642d943b312'),
        'cycle_link_reconciled_at', now(),
        'cycle_link_reconciliation_source', 'owner_confirmed_historical_bed_truth'
      ),
      updated_at = now()
  where id = '646322fc-d18b-45f9-a35f-84e0c05ab121'::uuid;

  update atlas.production_successions
  set crop_cycle_id = 'd6adccd6-bbad-4a3e-8bc7-f43f04289d16'::uuid,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'crop_cycle_ids', jsonb_build_array('d6adccd6-bbad-4a3e-8bc7-f43f04289d16'),
        'cycle_link_reconciled_at', now(),
        'cycle_link_reconciliation_source', 'completed_sowing_task_and_planting_claim'
      ),
      updated_at = now()
  where id = 'eda07e95-c343-48dd-b972-6d988a5deac9'::uuid;

  update atlas.production_successions
  set crop_cycle_id = '044044fa-cfef-4be0-9e46-880402a22529'::uuid,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'crop_cycle_ids', jsonb_build_array(
          '044044fa-cfef-4be0-9e46-880402a22529',
          '2119ad9b-2231-4e61-bc60-ac97144751b3'
        ),
        'cycle_link_reconciled_at', now(),
        'cycle_link_reconciliation_source', 'owner_confirmed_fr16_fr17_sowing_truth'
      ),
      updated_at = now()
  where id = 'b2143282-287c-4c17-8d7c-8677e849b429'::uuid;

  update atlas.production_successions
  set crop_cycle_id = 'cdd1012a-4982-4578-8209-5de93043f924'::uuid,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'crop_cycle_ids', jsonb_build_array(
          'cdd1012a-4982-4578-8209-5de93043f924',
          '69de7124-9d03-4d37-a0f1-7ad17e4b4d48',
          '5c4cc04a-705a-4172-9dc8-a91c456bfea7'
        ),
        'cycle_link_reconciled_at', now(),
        'cycle_link_reconciliation_source', 'owner_confirmed_bb5_bb7_grouped_sowing'
      ),
      updated_at = now()
  where id = '29bc9e50-e005-47ae-a1d0-b136d17c89e3'::uuid;

  update atlas.production_successions
  set state = 'sown',
      actual_sow_date = date '2026-07-18',
      crop_cycle_id = 'a58e1cc4-23e5-4bad-a4f8-4de6a082c229'::uuid,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'crop_cycle_ids', jsonb_build_array(
          'a58e1cc4-23e5-4bad-a4f8-4de6a082c229',
          'ebd5255d-d433-40f2-86cb-18cb7a21400c',
          'decda5ab-5299-4f23-8745-b07d726bc57d'
        ),
        'replacement_sown_date', date '2026-07-18',
        'cycle_link_reconciled_at', now(),
        'cycle_link_reconciliation_source', 'completed_bw3_bw5_interplant_task'
      ),
      updated_at = now()
  where id = '3743b0e0-a928-44d2-851c-aa6167ed25a1'::uuid;

  update atlas.crop_cycles
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'replacement_sown_date', date '2026-07-18',
        'replacement_task_id', '87034522-3ef6-41ae-b684-6c2991184eed',
        'replacement_record_reconciled_at', now()
      ),
      updated_at = now()
  where id in (
    'a58e1cc4-23e5-4bad-a4f8-4de6a082c229'::uuid,
    'ebd5255d-d433-40f2-86cb-18cb7a21400c'::uuid,
    'decda5ab-5299-4f23-8745-b07d726bc57d'::uuid
  );

  update atlas.production_successions
  set crop_cycle_id = '77b41361-ac68-469a-8cba-4e4b1e0405ba'::uuid,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'crop_cycle_ids', jsonb_build_array(
          '77b41361-ac68-469a-8cba-4e4b1e0405ba',
          '72741958-2c72-4fdd-8224-7a661e3229b7',
          'c5ffa64d-d09d-4615-995b-64006910478e',
          '77fad2eb-433e-4854-a073-582d5e65ff3c'
        ),
        'historical_cycle_profile_note', 'Bed cycles retain the generic Zinnia profile; production plan retains California Giant planning identity.',
        'cycle_link_reconciled_at', now()
      ),
      updated_at = now()
  where id = '7d286235-55c3-4698-9b84-b71e9ad0e130'::uuid;

  update atlas.production_successions
  set crop_cycle_id = '45e0994d-e136-4855-996f-8168822847f6'::uuid,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'crop_cycle_ids', jsonb_build_array(
          '45e0994d-e136-4855-996f-8168822847f6',
          'c5de8f66-3379-4fde-ad69-4f6cc4b1268c',
          'ca90160b-820a-4369-a5b4-6bc934324dec',
          '37a6493c-da39-4d7a-af19-fa3f6ee737e6'
        ),
        'historical_cycle_profile_note', 'Bed cycles retain the generic Zinnia profile; production plan retains California Giant planning identity.',
        'cycle_link_reconciled_at', now()
      ),
      updated_at = now()
  where id = '4addd2a9-8825-48b7-9fb5-a55c32f8ba8c'::uuid;

  insert into atlas.crop_cycles (
    farm_id, object_id, object_content_id, crop_profile_id, crop_cycle_key,
    crop_label, variety, cycle_state, lifecycle_status, sown_date, planted_date,
    germination_checked_date, note, metadata
  ) values (
    (select id from atlas.farms where stable_key = 'elm_farm'),
    'a4a38c04-6e88-415a-80fe-74da2cd7e3e0'::uuid,
    'fe4b7564-2b3a-4bef-8b44-bc9dd1b25dd6'::uuid,
    '5138c2af-f5b6-49d0-bd7a-0aa2eb896ad6'::uuid,
    'production_zinnia_mg10_20260623',
    'California Giant Zinnia',
    'California Giant / Special Collection',
    'growing',
    'active',
    date '2026-06-23',
    date '2026-06-23',
    date '2026-07-12',
    'Historical mixed MG10 sowing; Zinnia identity retained separately from Cosmos and perennial contents.',
    jsonb_build_object(
      'source', 'production_record_reconciliation_20260721',
      'production_succession_id', 'e03beb0d-3663-45a5-acc6-e2af00a8b9ec',
      'mixed_object_content_id', 'fe4b7564-2b3a-4bef-8b44-bc9dd1b25dd6',
      'historical_profile_source', 'zinnia_2026_production_plan',
      'field_truth_confidence', 'owner_confirmed_location_and_mixed_sowing'
    )
  )
  on conflict (farm_id, crop_cycle_key) do update
  set object_id = excluded.object_id,
      object_content_id = excluded.object_content_id,
      crop_profile_id = excluded.crop_profile_id,
      crop_label = excluded.crop_label,
      variety = excluded.variety,
      cycle_state = excluded.cycle_state,
      lifecycle_status = excluded.lifecycle_status,
      sown_date = excluded.sown_date,
      planted_date = excluded.planted_date,
      germination_checked_date = excluded.germination_checked_date,
      note = excluded.note,
      metadata = coalesce(atlas.crop_cycles.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now()
  returning id into v_zinnia_mg10_cycle_id;

  update atlas.production_successions
  set crop_cycle_id = v_zinnia_mg10_cycle_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'crop_cycle_ids', jsonb_build_array(v_zinnia_mg10_cycle_id),
        'cycle_link_reconciled_at', now(),
        'cycle_link_reconciliation_source', 'owner_confirmed_mg10_mixed_sowing'
      ),
      updated_at = now()
  where id = 'e03beb0d-3663-45a5-acc6-e2af00a8b9ec'::uuid;

  insert into atlas.task_crop_cycles (task_id, crop_cycle_id, role, confidence, source, metadata)
  values
    ('c1a51cef-54ab-4752-8772-2aa5f677f005'::uuid, 'd6adccd6-bbad-4a3e-8bc7-f43f04289d16'::uuid, 'creates', 'confirmed', 'production_reconciliation', '{}'::jsonb),
    ('6a530f4f-87a1-4918-b3b8-c1f3bd9301ec'::uuid, '044044fa-cfef-4be0-9e46-880402a22529'::uuid, 'creates', 'confirmed', 'production_reconciliation', '{}'::jsonb),
    ('49f22546-aeb1-49a0-b8c9-7124f91c0822'::uuid, '2119ad9b-2231-4e61-bc60-ac97144751b3'::uuid, 'creates', 'confirmed', 'production_reconciliation', '{}'::jsonb),
    ('a8b65f61-6c39-4fe3-a419-872f13cabb68'::uuid, 'cdd1012a-4982-4578-8209-5de93043f924'::uuid, 'creates', 'confirmed', 'production_reconciliation', '{}'::jsonb),
    ('a8b65f61-6c39-4fe3-a419-872f13cabb68'::uuid, '69de7124-9d03-4d37-a0f1-7ad17e4b4d48'::uuid, 'creates', 'confirmed', 'production_reconciliation', '{}'::jsonb),
    ('a8b65f61-6c39-4fe3-a419-872f13cabb68'::uuid, '5c4cc04a-705a-4172-9dc8-a91c456bfea7'::uuid, 'creates', 'confirmed', 'production_reconciliation', '{}'::jsonb),
    ('87034522-3ef6-41ae-b684-6c2991184eed'::uuid, 'a58e1cc4-23e5-4bad-a4f8-4de6a082c229'::uuid, 'affects', 'confirmed', 'production_reconciliation', jsonb_build_object('mode', 'interplant')),
    ('87034522-3ef6-41ae-b684-6c2991184eed'::uuid, 'ebd5255d-d433-40f2-86cb-18cb7a21400c'::uuid, 'affects', 'confirmed', 'production_reconciliation', jsonb_build_object('mode', 'interplant')),
    ('87034522-3ef6-41ae-b684-6c2991184eed'::uuid, 'decda5ab-5299-4f23-8745-b07d726bc57d'::uuid, 'affects', 'confirmed', 'production_reconciliation', jsonb_build_object('mode', 'interplant'))
  on conflict (task_id, crop_cycle_id, role) do nothing;

  update atlas.object_contents
  set planting_claim_id = '821e08ef-6c41-4507-bca6-cd884f6606f3'::uuid,
      crop_profile_id = '8614ca74-a489-456d-8b40-6cffa949ad12'::uuid,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'planting_claim_link_reconciled_at', now(),
        'planting_claim_link_source', 'exact_object_crop_date_match'
      ),
      updated_at = now()
  where id = '4f2e5e37-4634-43b7-9831-fa73374cee2e'::uuid;

  insert into atlas.object_contents (
    farm_id, object_id, planting_claim_id, crop_profile_id, content_label,
    content_type, variety, planted_date, status, confidence,
    expected_germination_start, expected_germination_end,
    expected_harvest_watch_start, expected_harvest_watch_end, expected_clear_date,
    note, metadata, start_method
  )
  select
    pc.farm_id,
    '0bff25f3-8dff-4eab-8bbb-7a87ea058e24'::uuid,
    pc.id,
    pc.crop_profile_id,
    pc.crop_label,
    'planting',
    pc.variety,
    pc.planted_date,
    'germinated',
    pc.confidence,
    pc.expected_germination_start,
    pc.expected_germination_end,
    pc.expected_harvest_watch_start,
    pc.expected_harvest_watch_end,
    pc.expected_clear_date,
    pc.note,
    jsonb_build_object(
      'source', 'planting_claim_content_reconciliation_20260721',
      'source_task_id', 'c1a51cef-54ab-4752-8772-2aa5f677f005'
    ),
    'direct_sow'
  from atlas.planting_claims pc
  where pc.id = 'd23bba3b-c5ad-400f-8fe2-f71b72e5ccc2'::uuid
    and not exists (
      select 1 from atlas.object_contents oc where oc.planting_claim_id = pc.id
    )
  returning id into v_cosmos_fr1_content_id;

  if v_cosmos_fr1_content_id is null then
    select id into v_cosmos_fr1_content_id
    from atlas.object_contents
    where planting_claim_id = 'd23bba3b-c5ad-400f-8fe2-f71b72e5ccc2'::uuid
    order by created_at
    limit 1;
  end if;

  update atlas.crop_cycles
  set object_content_id = v_cosmos_fr1_content_id,
      updated_at = now()
  where id = 'd6adccd6-bbad-4a3e-8bc7-f43f04289d16'::uuid
    and v_cosmos_fr1_content_id is not null;

  update atlas.object_contents
  set planting_claim_id = '797aa795-9efe-43a4-a60c-75d2656fb92f'::uuid,
      crop_profile_id = '769f6f3f-fcaa-48c6-9869-4629208d0b4d'::uuid,
      content_label = 'Sunflower',
      variety = 'ProCut Orange',
      planted_date = date '2026-07-14',
      start_method = 'direct_sow',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'previous_sown_date', date '2026-06-17',
        'hard_reset_date', date '2026-07-13',
        'fresh_sow_date', date '2026-07-14',
        'planting_claim_link_reconciled_at', now(),
        'planting_claim_link_source', 'completed_fresh_sowing_task'
      ),
      updated_at = now()
  where id = 'e7996cff-4961-4abc-bbfa-11da1245962b'::uuid;

  update atlas.crop_cycles
  set planting_claim_id = '797aa795-9efe-43a4-a60c-75d2656fb92f'::uuid,
      object_content_id = 'e7996cff-4961-4abc-bbfa-11da1245962b'::uuid,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'planting_claim_link_reconciled_at', now()
      ),
      updated_at = now()
  where id = '044044fa-cfef-4be0-9e46-880402a22529'::uuid;

  update atlas.object_contents
  set crop_profile_id = 'e47dffd4-4c68-401b-bb3a-70b6e6e781dd'::uuid,
      content_label = 'Sunflower',
      variety = 'ProCut Horizon',
      planted_date = date '2026-07-14',
      start_method = 'direct_sow',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'previous_sown_date', date '2026-06-17',
        'hard_reset_date', date '2026-07-13',
        'fresh_sow_date', date '2026-07-14',
        'crop_identity_reconciled_at', now(),
        'crop_identity_reconciliation_source', 'completed_fresh_sowing_task'
      ),
      updated_at = now()
  where id = '9489a9e3-e8e1-4e43-b227-234419494db9'::uuid;
end;
$migration$;
