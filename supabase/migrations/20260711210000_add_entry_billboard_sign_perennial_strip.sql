do $$
declare
  v_farm_id uuid;
  v_zone_id uuid;
  v_object_id uuid;
begin
  select farm_id, id into v_farm_id, v_zone_id
  from atlas.zones
  where stable_key = 'entry_billboard'
  limit 1;

  select id into v_object_id
  from atlas.growing_objects
  where stable_key = 'entry_billboard_sign_perennial_strip'
  limit 1;

  if v_object_id is null then
    insert into atlas.growing_objects (
      farm_id, zone_id, stable_key, label, object_type, object_mode,
      length_ft, width_ft, area_sqft, guest_visible, sort_order, metadata
    )
    values (
      v_farm_id,
      v_zone_id,
      'entry_billboard_sign_perennial_strip',
      'Elm Farm Sign Perennial Strip',
      'bed',
      'perennial',
      20,
      4,
      80,
      true,
      90,
      jsonb_build_object(
        'role', 'sign_front_perennial_strip',
        'permanent_bed', true,
        'dimension_source', 'user_report_20260711',
        'size_label', '4 ft x 20 ft',
        'notes', 'Perennial planting strip associated with the Elm Farm sign in the Entry Billboard Garden.'
      )
    );
  else
    update atlas.growing_objects
    set zone_id = v_zone_id,
        label = 'Elm Farm Sign Perennial Strip',
        object_type = 'bed',
        object_mode = 'perennial',
        length_ft = 20,
        width_ft = 4,
        area_sqft = 80,
        guest_visible = true,
        sort_order = 90,
        metadata = metadata || jsonb_build_object(
          'role', 'sign_front_perennial_strip',
          'permanent_bed', true,
          'dimension_source', 'user_report_20260711',
          'size_label', '4 ft x 20 ft',
          'notes', 'Perennial planting strip associated with the Elm Farm sign in the Entry Billboard Garden.'
        ),
        updated_at = now()
    where id = v_object_id;
  end if;

  update atlas.zones
  set metadata = metadata || jsonb_build_object(
    'sign_perennial_strip_length_ft', 20,
    'sign_perennial_strip_width_ft', 4,
    'sign_perennial_strip_area_sqft', 80,
    'sign_perennial_strip_object_key', 'entry_billboard_sign_perennial_strip'
  ),
  updated_at = now()
  where id = v_zone_id;
end $$;
