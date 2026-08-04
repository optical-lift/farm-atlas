-- Queue small, independently dated pressure-washing goals for Anna without flooding Today.

begin;

select set_config('atlas.reservoir_migration', 'on', true);

do $migration$
declare
  v_farm_id uuid;
  v_org_id uuid;
  v_owner_user_id uuid;
  v_anna_membership_id uuid;
  v_anna_user_id uuid;
  v_venue_zone_id uuid;
  v_main_garden_zone_id uuid;
  v_front_porch_id uuid;
  v_back_porch_id uuid;
  v_concrete_entrance_id uuid;
  v_attached_garage_id uuid;
  v_detached_garage_id uuid;
  v_spirea_wall_id uuid;
  v_library_addition_id uuid;
  v_occurrence_id uuid;
  v_task_key text;
  v_relation_payload jsonb;
  item record;
begin
  select id, organization_id
  into v_farm_id, v_org_id
  from atlas.farms
  where stable_key = 'elm_farm';

  select user_id
  into v_owner_user_id
  from atlas.farm_memberships
  where farm_id = v_farm_id
    and worker_key = 'lex'
    and active
  limit 1;

  select id, user_id
  into v_anna_membership_id, v_anna_user_id
  from atlas.farm_memberships
  where farm_id = v_farm_id
    and worker_key = 'anna'
    and active
  limit 1;

  select id into v_venue_zone_id
  from atlas.zones
  where farm_id = v_farm_id
    and stable_key = 'venue';

  select id into v_main_garden_zone_id
  from atlas.zones
  where farm_id = v_farm_id
    and stable_key = 'main_garden';

  if v_farm_id is null
     or v_org_id is null
     or v_owner_user_id is null
     or v_anna_membership_id is null
     or v_anna_user_id is null
     or v_venue_zone_id is null
     or v_main_garden_zone_id is null then
    raise exception 'Elm Farm, owner, Anna, Venue, and Main Garden records are required.';
  end if;

  insert into atlas.growing_objects(
    farm_id, zone_id, stable_key, label, object_type, object_mode,
    guest_visible, sort_order, metadata
  ) values
    (
      v_farm_id, v_venue_zone_id, 'venue_back_porch', 'Back Porch', 'area', 'maintenance',
      true, 815,
      jsonb_build_object(
        'source', 'owner_instruction_20260804',
        'object_subtype', 'venue_exterior_space',
        'is_growing_space', false,
        'surface_material', 'cedar siding and porch surfaces',
        'surface_condition', 'mildew present',
        'cleaning_method', 'gentle pressure wash'
      )
    ),
    (
      v_farm_id, v_venue_zone_id, 'venue_concrete_entrance_porch', 'Concrete Entrance Porch', 'area', 'maintenance',
      true, 816,
      jsonb_build_object(
        'source', 'owner_instruction_20260804',
        'object_subtype', 'venue_exterior_space',
        'is_growing_space', false,
        'surface_material', 'concrete',
        'surface_condition', 'mildew and exterior buildup present',
        'cleaning_method', 'gentle pressure wash'
      )
    ),
    (
      v_farm_id, v_venue_zone_id, 'venue_library_addition_exterior', 'Library Addition Exterior', 'area', 'maintenance',
      true, 817,
      jsonb_build_object(
        'source', 'owner_instruction_20260804',
        'object_subtype', 'building_exterior',
        'related_room_key', 'venue_library',
        'is_growing_space', false,
        'surface_material', 'cedar siding',
        'surface_condition', 'mildew present',
        'cleaning_method', 'gentle pressure wash'
      )
    ),
    (
      v_farm_id, v_main_garden_zone_id, 'attached_garage_wall_behind_spirea', 'Attached Garage Wall Behind Spirea', 'area', 'maintenance',
      true, 818,
      jsonb_build_object(
        'source', 'owner_instruction_20260804',
        'object_subtype', 'building_exterior_section',
        'related_structure_key', 'attached_garage_exterior',
        'screening_plant_key', 'garage_west_corner_spirea',
        'is_growing_space', false,
        'surface_material', 'cedar siding',
        'surface_condition', 'mildew present behind shrubs',
        'cleaning_method', 'gentle pressure wash while protecting shrubs'
      )
    )
  on conflict (farm_id, stable_key) do update
  set zone_id = excluded.zone_id,
      label = excluded.label,
      object_type = excluded.object_type,
      object_mode = excluded.object_mode,
      guest_visible = excluded.guest_visible,
      metadata = coalesce(atlas.growing_objects.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now();

  select id into v_front_porch_id
  from atlas.growing_objects
  where farm_id = v_farm_id and stable_key = 'venue_front_porch';

  select id into v_back_porch_id
  from atlas.growing_objects
  where farm_id = v_farm_id and stable_key = 'venue_back_porch';

  select id into v_concrete_entrance_id
  from atlas.growing_objects
  where farm_id = v_farm_id and stable_key = 'venue_concrete_entrance_porch';

  select id into v_attached_garage_id
  from atlas.growing_objects
  where farm_id = v_farm_id and stable_key = 'attached_garage_exterior';

  select id into v_detached_garage_id
  from atlas.growing_objects
  where farm_id = v_farm_id and stable_key = 'detached_garage_trading_post';

  select id into v_spirea_wall_id
  from atlas.growing_objects
  where farm_id = v_farm_id and stable_key = 'attached_garage_wall_behind_spirea';

  select id into v_library_addition_id
  from atlas.growing_objects
  where farm_id = v_farm_id and stable_key = 'venue_library_addition_exterior';

  if v_front_porch_id is null
     or v_back_porch_id is null
     or v_concrete_entrance_id is null
     or v_attached_garage_id is null
     or v_detached_garage_id is null
     or v_spirea_wall_id is null
     or v_library_addition_id is null then
    raise exception 'Every pressure-washing location must resolve to one canonical physical object.';
  end if;

  update atlas.growing_objects
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'surface_condition', 'mildew present',
        'cleaning_method', 'gentle pressure wash',
        'condition_observed_on', '2026-08-04',
        'cleaning_collection_key', 'anna_gentle_pressure_wash_aug_2026'
      ),
      updated_at = now()
  where id in (
    v_front_porch_id,
    v_back_porch_id,
    v_concrete_entrance_id,
    v_attached_garage_id,
    v_detached_garage_id,
    v_spirea_wall_id,
    v_library_addition_id
  );

  for item in
    select *
    from (values
      (
        1,
        date '2026-08-06',
        'back_porch',
        'Gently Pressure Wash Back Porch',
        'Back Porch',
        'Back Porch',
        v_venue_zone_id,
        v_back_porch_id,
        'cedar_and_porch',
        'Use the gentle method already established: wide fan, low pressure, keep the wand moving, and stop when the mildew lifts. Do not raise the cedar grain.'
      ),
      (
        4,
        date '2026-08-08',
        'attached_garage_face',
        'Gently Pressure Wash Attached Garage Face',
        'Attached Garage Face',
        'Main Garden / Tea Courtyard',
        v_main_garden_zone_id,
        v_attached_garage_id,
        'cedar_siding',
        'Clean the mildewed face only. Use a wide fan and low pressure; protect the AC unit, electrical boxes, windows, and door openings from direct spray.'
      ),
      (
        6,
        date '2026-08-10',
        'behind_garage_spirea',
        'Gently Pressure Wash Behind the Garage Spirea',
        'Garage Wall Behind Spirea',
        'Main Garden / Tea Courtyard',
        v_main_garden_zone_id,
        v_spirea_wall_id,
        'cedar_siding_behind_shrubs',
        'Reach the mildewed siding behind the spirea without blasting the stems, roots, or soil. Use angles and distance that protect the shrubs.'
      ),
      (
        5,
        date '2026-08-11',
        'detached_garage_face',
        'Gently Pressure Wash Detached Garage Face',
        'Detached Garage Face',
        'Venue',
        v_venue_zone_id,
        v_detached_garage_id,
        'wood_siding',
        'Clean one garage face as a small goal. Use a wide fan, low pressure, and keep the wand moving; avoid forcing water into doors, windows, and trim joints.'
      ),
      (
        7,
        date '2026-08-12',
        'library_addition_siding',
        'Gently Pressure Wash Library Addition Siding',
        'Library Addition Siding',
        'Venue',
        v_venue_zone_id,
        v_library_addition_id,
        'cedar_siding',
        'Wash the mildewed siding gently, one manageable section at a time. Protect the window, trim joints, AC equipment, and any open gaps from direct spray.'
      ),
      (
        2,
        date '2026-08-14',
        'front_porch',
        'Gently Pressure Wash Front Porch',
        'Front Porch',
        'Venue',
        v_venue_zone_id,
        v_front_porch_id,
        'cedar_and_porch',
        'Use the gentle method already established. Keep direct spray off painted doors, window seals, trim joints, electrical fixtures, and the foundation bed.'
      ),
      (
        3,
        date '2026-08-15',
        'concrete_entrance_porch',
        'Pressure Wash Concrete Entrance Porch',
        'Concrete Entrance Porch',
        'Venue',
        v_venue_zone_id,
        v_concrete_entrance_id,
        'concrete',
        'Wash the concrete surface and edges as one small goal. Keep the spray off nearby cedar, door seals, painted trim, and plantings.'
      )
    ) as scheduled(
      source_order,
      due_date,
      slug,
      title,
      display_subject,
      collection_zone,
      zone_id,
      object_id,
      surface_type,
      task_note
    )
  loop
    v_task_key := 'anna_' || to_char(item.due_date, 'YYYYMMDD') || '_gentle_pressure_wash_' || item.slug;

    v_relation_payload := jsonb_build_object(
      'task_objects',
      jsonb_build_array(
        jsonb_build_object(
          'object_id', item.object_id,
          'role', 'target'
        )
      )
    );

    v_occurrence_id := atlas.plan_work_occurrence_v1(
      v_farm_id,
      'one_off:' || v_task_key,
      'one_off:' || v_task_key || ':release',
      'one_off:' || v_task_key,
      item.title,
      'exterior_cleaning',
      item.due_date,
      'owner_instruction',
      null,
      'time_window',
      0,
      1,
      jsonb_build_object(
        'title', item.title,
        'task_type', 'exterior_cleaning',
        'priority', 'normal',
        'zone_id', item.zone_id,
        'note', item.task_note,
        'action_key', 'pressure_wash',
        'work_class', 'standard',
        'visibility_scope', 'assigned_worker',
        'assigned_membership_id', v_anna_membership_id,
        'assigned_user_id', v_anna_user_id,
        'created_by_user_id', v_owner_user_id,
        'origin_kind', 'owner_assigned',
        'task_scope', 'farm_operation',
        'organization_id', v_org_id,
        'metadata', jsonb_build_object(
          'task_key', v_task_key,
          'anna_task', true,
          'owner_task', false,
          'assigned_to', 'Anna',
          'assignee_key', 'anna',
          'executor_worker_key', 'anna',
          'executor_membership_id', v_anna_membership_id,
          'executor_role', 'farm_hand',
          'executor_label', 'Anna',
          'display_action', case when item.surface_type = 'concrete' then 'Pressure wash' else 'Gently pressure wash' end,
          'display_subject', item.display_subject,
          'display_location', item.display_subject,
          'collection_zone', item.collection_zone,
          'collection_label', 'Gentle Mildew Wash · ' || item.display_subject,
          'work_lane', 'process_continuation',
          'commitment_kind', 'hard_date',
          'date_commitment', 'hard_date',
          'effort_units', 0.5,
          'simple_completion_task', true,
          'owner_instruction_date', '2026-08-04',
          'pressure_wash_collection_key', 'anna_gentle_pressure_wash_aug_2026',
          'pressure_wash_source_order', item.source_order,
          'pressure_wash_surface_type', item.surface_type,
          'gentle_cedar_method', item.surface_type <> 'concrete',
          'scheduled_to_appear_on_due_date', true,
          'work_window_key', 'morning'
        )
      ),
      v_relation_payload,
      jsonb_build_object(
        'automatic', true,
        'source_kind', 'owner_instruction',
        'drip_on_due_date', true
      ),
      item.due_date,
      jsonb_build_object(
        'source', 'owner_instruction_20260804',
        'hardDate', true,
        'dripCollection', 'anna_gentle_pressure_wash_aug_2026',
        'scheduledToAppearOnDueDate', true,
        'sourceOrder', item.source_order
      )
    );

    update atlas.planned_work_occurrences
    set work_lane = 'process_continuation',
        commitment_kind = 'hard_date',
        effort_units = 0.5,
        updated_at = now()
    where id = v_occurrence_id;
  end loop;

  perform atlas.release_eligible_work_v1(v_farm_id, date '2026-08-04', 500);
end;
$migration$;

commit;
