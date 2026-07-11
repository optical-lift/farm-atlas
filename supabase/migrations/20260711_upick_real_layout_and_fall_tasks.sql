-- Real U-Pick ground truth recorded 2026-07-11.
-- 12 beds, six mirrored on each side; each bed 3 ft x 50 ft.
-- Ten 5 ft internal grass walkways and one 15 ft middle partition.
-- This migration is intentionally idempotent.

do $$
declare
  v_zone_id uuid;
  v_farm_id uuid;
  v_task_id uuid;
  i integer;
  v_object_id uuid;
begin
  select id, farm_id into v_zone_id, v_farm_id
  from atlas.zones
  where stable_key = 'u_pick'
  limit 1;

  if v_zone_id is null then
    raise exception 'Atlas U-Pick zone (stable_key=u_pick) not found';
  end if;

  update atlas.zones
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'layout_verified_date', '2026-07-11',
        'bed_count', 12,
        'beds_per_side', 6,
        'bed_length_ft', 50,
        'bed_width_ft', 3,
        'bed_area_sqft', 150,
        'total_growing_area_sqft', 1800,
        'walkway_width_ft', 5,
        'middle_partition_width_ft', 15,
        'internal_footprint_width_ft', 101,
        'internal_footprint_length_ft', 50,
        'internal_footprint_sqft', 5050,
        'layout_note', 'Twelve 3 ft x 50 ft beds, six mirrored on each side, with 5 ft mowed walkways and a 15 ft middle partition.'
      ),
      updated_at = now()
  where id = v_zone_id;

  for i in 1..12 loop
    insert into atlas.growing_objects (
      farm_id, zone_id, stable_key, label, object_type, object_mode,
      length_ft, width_ft, area_sqft, guest_visible, sort_order, metadata
    ) values (
      v_farm_id, v_zone_id, 'u_pick_bed_' || i, 'U-Pick Bed ' || i,
      'bed', 'annual_production', 50, 3, 150, true, i,
      jsonb_build_object(
        'layout_verified_date', '2026-07-11',
        'block_side', case when i <= 6 then 'side_a' else 'side_b' end,
        'mirrored_position', case when i <= 6 then i else i - 6 end,
        'spring_2027_role', 'overwintered spring U-Pick crops followed by summer U-Pick turnover',
        'walkway_width_ft', 5
      )
    )
    on conflict (farm_id, stable_key) do update set
      zone_id = excluded.zone_id,
      label = excluded.label,
      object_type = excluded.object_type,
      object_mode = excluded.object_mode,
      length_ft = excluded.length_ft,
      width_ft = excluded.width_ft,
      area_sqft = excluded.area_sqft,
      guest_visible = excluded.guest_visible,
      sort_order = excluded.sort_order,
      metadata = coalesce(atlas.growing_objects.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now();
  end loop;

  for i in 1..10 loop
    insert into atlas.growing_objects (
      farm_id, zone_id, stable_key, label, object_type, object_mode,
      length_ft, width_ft, area_sqft, guest_visible, sort_order, metadata
    ) values (
      v_farm_id, v_zone_id, 'u_pick_walkway_' || i, 'U-Pick Walkway ' || i,
      'path', 'hospitality_showcase', 50, 5, 250, true, 100 + i,
      jsonb_build_object(
        'layout_verified_date', '2026-07-11',
        'surface', 'mowed_grass',
        'maintenance_collection', 'mowing',
        'equipment_fit', 'riding_mower'
      )
    )
    on conflict (farm_id, stable_key) do update set
      zone_id = excluded.zone_id,
      label = excluded.label,
      object_type = excluded.object_type,
      object_mode = excluded.object_mode,
      length_ft = excluded.length_ft,
      width_ft = excluded.width_ft,
      area_sqft = excluded.area_sqft,
      guest_visible = excluded.guest_visible,
      sort_order = excluded.sort_order,
      metadata = coalesce(atlas.growing_objects.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now();
  end loop;

  insert into atlas.growing_objects (
    farm_id, zone_id, stable_key, label, object_type, object_mode,
    length_ft, width_ft, area_sqft, guest_visible, sort_order, metadata
  ) values (
    v_farm_id, v_zone_id, 'u_pick_middle_partition', 'U-Pick Middle Partition',
    'corridor', 'hospitality_showcase', 50, 15, 750, true, 120,
    jsonb_build_object(
      'layout_verified_date', '2026-07-11',
      'surface', 'mowed_grass',
      'maintenance_collection', 'mowing',
      'role', 'main guest and equipment corridor'
    )
  )
  on conflict (farm_id, stable_key) do update set
    zone_id = excluded.zone_id,
    label = excluded.label,
    object_type = excluded.object_type,
    object_mode = excluded.object_mode,
    length_ft = excluded.length_ft,
    width_ft = excluded.width_ft,
    area_sqft = excluded.area_sqft,
    guest_visible = excluded.guest_visible,
    sort_order = excluded.sort_order,
    metadata = coalesce(atlas.growing_objects.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

  update atlas.growing_objects
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'legacy_general_area', true,
        'superseded_by_verified_layout_date', '2026-07-11'
      ),
      updated_at = now()
  where farm_id = v_farm_id and stable_key = 'u_pick_current_patch';

  -- U-Pick mowing was already a canonical Mowing collection member. Update it
  -- rather than creating a duplicate.
  update atlas.tasks
  set zone_id = v_zone_id,
      title = 'Mowing — U-Pick Walkways + Middle Lane',
      note = 'Mow the ten 5 ft grass walkways and the 15 ft middle partition between the two mirrored six-bed blocks. Keep the 3 ft x 50 ft growing beds unmowed.',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'display_subject', 'U-Pick walkways + middle lane',
        'display_detail', '10 walkways + 15 ft middle lane',
        'collection_label', 'U-Pick walkways + middle lane',
        'collection_zone', 'U-Pick',
        'equipment_group', 'riding_mower',
        'real_layout_verified', true,
        'layout_verified_date', '2026-07-11'
      ),
      updated_at = now()
  where metadata->>'work_collection_key' = 'mowing'
    and metadata->>'collection_member_key' = 'u_pick_paths'
    and status in ('open','blocked','done');

  if not exists (select 1 from atlas.tasks where metadata->>'task_key' = 'upick_till_12_beds_20261022') then
    insert into atlas.tasks (farm_id, zone_id, title, task_type, status, priority, due_date, unlock_text, note, metadata)
    values (
      v_farm_id, v_zone_id, 'Till the 12 U-Pick Beds', 'bed_preparation', 'open', 'high', '2026-10-22',
      'Creates a clean seedbed for overwintering spring U-Pick flowers while preserving permanent grass walkways.',
      'Till only the twelve 3 ft x 50 ft beds. Do not till the ten 5 ft walkways or the 15 ft middle partition.',
      jsonb_build_object(
        'task_key', 'upick_till_12_beds_20261022', 'anna_task', true, 'owner_task', false,
        'assigned_to', 'Anna', 'work_route', 'prepare', 'work_rhythm', 'Fall Bed Preparation',
        'display_action', 'Till', 'display_subject', '12 U-Pick beds',
        'display_detail', '12 beds · 1,800 growing sq ft', 'collection_zone', 'U-Pick',
        'collection_label', 'Fall U-Pick Preparation',
        'detail_lines', jsonb_build_array(
          'Till twelve beds, each 3 ft x 50 ft', 'Keep all 5 ft grass walkways intact',
          'Keep the 15 ft middle partition intact', 'Remove mature ragweed seed heads before tilling',
          'Beds total 1,800 sq ft'
        )
      )
    ) returning id into v_task_id;

    for v_object_id in select id from atlas.growing_objects where farm_id = v_farm_id and stable_key ~ '^u_pick_bed_([1-9]|1[0-2])$'
    loop
      insert into atlas.task_objects (task_id, object_id, role) values (v_task_id, v_object_id, 'target') on conflict do nothing;
    end loop;
  end if;

  if not exists (select 1 from atlas.tasks where metadata->>'task_key' = 'upick_sow_overwintering_spring_crops_20261026') then
    insert into atlas.tasks (farm_id, zone_id, title, task_type, status, priority, due_date, unlock_text, note, metadata)
    values (
      v_farm_id, v_zone_id, 'Sow Overwintering Spring U-Pick Crops', 'sowing', 'open', 'high', '2026-10-26',
      'Establishes the Spring 2027 U-Pick bloom before the beds turn over to summer U-Pick crops.',
      'Direct-sow the assigned hardy spring U-Pick crops across the prepared 3 ft x 50 ft beds, including poppies and cornflowers/bachelor buttons. Label each bed and record the exact crop assignment.',
      jsonb_build_object(
        'task_key', 'upick_sow_overwintering_spring_crops_20261026', 'anna_task', true, 'owner_task', false,
        'assigned_to', 'Anna', 'work_route', 'sow', 'work_rhythm', 'Fall Sowing',
        'display_action', 'Sow', 'display_subject', 'Spring U-Pick crops', 'display_detail', '12 prepared beds',
        'collection_zone', 'U-Pick', 'collection_label', 'Fall U-Pick Preparation',
        'detail_lines', jsonb_build_array(
          'Use the final named bed-by-bed crop map', 'Core crops include poppies and cornflowers/bachelor buttons',
          'Label every bed after sowing', 'Record seed source and amount used',
          'Spring crop clears bed-by-bed into summer U-Pick planting'
        )
      )
    ) returning id into v_task_id;

    for v_object_id in select id from atlas.growing_objects where farm_id = v_farm_id and stable_key ~ '^u_pick_bed_([1-9]|1[0-2])$'
    loop
      insert into atlas.task_objects (task_id, object_id, role) values (v_task_id, v_object_id, 'target') on conflict do nothing;
    end loop;
  end if;

  if not exists (select 1 from atlas.tasks where metadata->>'task_key' = 'owner_schedule_upick_tilling_20260924') then
    insert into atlas.tasks (farm_id, zone_id, title, task_type, status, priority, due_date, note, metadata)
    values (
      v_farm_id, v_zone_id, 'Owner — Schedule U-Pick Tilling', 'owner_planning', 'open', 'high', '2026-09-24',
      'Schedule or confirm the equipment/operator for tilling the twelve U-Pick beds on October 22. This is four weeks before the tilling date.',
      jsonb_build_object(
        'task_key', 'owner_schedule_upick_tilling_20260924', 'anna_task', false, 'owner_task', true,
        'assigned_to', 'Owner', 'work_route', 'owner', 'work_rhythm', 'Owner Work',
        'display_action', 'Schedule', 'display_subject', 'U-Pick tilling', 'display_detail', 'For Oct 22',
        'collection_zone', 'Owner', 'collection_label', 'U-Pick Fall Preparation',
        'detail_lines', jsonb_build_array(
          'Confirm tiller or tractor availability', 'Confirm operator and cost if hired',
          'Specify beds only: twelve 3 ft x 50 ft strips', 'Protect 5 ft walkways and 15 ft middle partition'
        )
      )
    );
  end if;

  if not exists (select 1 from atlas.tasks where metadata->>'task_key' = 'owner_obtain_bulk_upick_seed_20261005') then
    insert into atlas.tasks (farm_id, zone_id, title, task_type, status, priority, due_date, note, metadata)
    values (
      v_farm_id, v_zone_id, 'Owner — Purchase or Obtain Bulk Spring U-Pick Seed', 'owner_procurement', 'open', 'high', '2026-10-05',
      'Purchase, source, or confirm enough bulk hardy-annual seed for the October 26 U-Pick sowing. This is three weeks before sowing.',
      jsonb_build_object(
        'task_key', 'owner_obtain_bulk_upick_seed_20261005', 'anna_task', false, 'owner_task', true,
        'assigned_to', 'Owner', 'work_route', 'owner', 'work_rhythm', 'Owner Work',
        'display_action', 'Obtain', 'display_subject', 'Bulk spring U-Pick seed', 'display_detail', 'For Oct 26 sowing',
        'collection_zone', 'Owner', 'collection_label', 'U-Pick Fall Preparation',
        'detail_lines', jsonb_build_array(
          'Confirm final bed-by-bed spring crop map', 'Count on-hand poppy and cornflower/bachelor-button seed',
          'Purchase or obtain any shortfall in bulk', 'Label seed by assigned U-Pick bed before sowing day'
        )
      )
    );
  end if;
end $$;
