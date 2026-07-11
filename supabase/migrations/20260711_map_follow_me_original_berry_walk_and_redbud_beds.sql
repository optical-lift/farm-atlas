-- Map verified Follow Me, Original Berry Walk, and Redbud growing dimensions.
-- This migration is idempotent and mirrors the live Atlas registry update.

do $$
declare
  v_farm uuid;
  v_obw_zone uuid;
begin
  select id into v_farm from atlas.farms order by created_at limit 1;
  select id into v_obw_zone from atlas.zones where stable_key='original_berry_walk' limit 1;

  update atlas.growing_objects g
  set length_ft = 5,
      width_ft = 3,
      area_sqft = 15,
      metadata = coalesce(g.metadata,'{}'::jsonb) || jsonb_build_object(
        'dimension_source','user_report_20260711',
        'dimension_status','verified',
        'size_label','5 ft x 3 ft'
      ),
      updated_at = now()
  from atlas.zones z
  where g.zone_id=z.id
    and z.stable_key='follow_me'
    and g.stable_key <> 'flowers_arch_04_right_bed';

  update atlas.growing_objects g
  set length_ft = 3,
      width_ft = 3,
      area_sqft = 9,
      metadata = coalesce(g.metadata,'{}'::jsonb) || jsonb_build_object(
        'dimension_source','user_report_20260711',
        'dimension_status','verified_size_pending_exact_position_confirmation',
        'size_label','3 ft x 3 ft',
        'registry_note','Assigned to Arch 4 Right as the small-bed anchor; swap dimensions if the small bed is a different arch side.'
      ),
      updated_at = now()
  from atlas.zones z
  where g.zone_id=z.id
    and z.stable_key='follow_me'
    and g.stable_key='flowers_arch_04_right_bed';

  update atlas.zones
  set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'bed_count',8,
        'standard_bed_count',7,
        'standard_bed_length_ft',5,
        'standard_bed_width_ft',3,
        'small_bed_count',1,
        'small_bed_length_ft',3,
        'small_bed_width_ft',3,
        'total_growing_area_sqft',114,
        'layout_verified_date','2026-07-11'
      ),
      updated_at=now()
  where stable_key='follow_me';

  update atlas.growing_objects
  set object_type='bed',
      length_ft=25,
      width_ft=8,
      area_sqft=527.787566,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'dimension_source','user_report_20260711',
        'geometry_model','concentric semicircular crescent',
        'outer_radius_ft',25,
        'inner_radius_ft',17,
        'maximum_crescent_width_ft',8,
        'area_formula','0.5*pi*(25^2-17^2)',
        'area_status','geometry_estimate_from_verified_measurements'
      ),
      updated_at=now()
  where stable_key='berry_walk_crescent_moon';

  update atlas.growing_objects
  set label='Berry Walk Spiral Path',
      object_type='path',
      length_ft=162.083598,
      width_ft=2,
      area_sqft=324.167196,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'dimension_source','user_report_20260711',
        'geometry_model','three-turn Archimedean spiral inside 17-ft inner radius',
        'turn_count',3,
        'path_width_ft',2,
        'estimated_centerline_length_ft',162.083598,
        'area_status','working_geometry_estimate'
      ),
      updated_at=now()
  where stable_key='berry_walk_labyrinth_walk';

  insert into atlas.growing_objects (
    farm_id, zone_id, stable_key, label, object_type, object_mode,
    length_ft, width_ft, area_sqft, guest_visible, sort_order, metadata
  ) values (
    v_farm, v_obw_zone, 'berry_walk_spiral_perennial_pockets',
    'Berry Walk Spiral Perennial Pockets', 'bed', 'perennial_nursery',
    17, null, 129.793711, true, 62,
    jsonb_build_object(
      'dimension_source','user_report_20260711',
      'geometry_model','inner semicircle minus three-turn 2-ft spiral path',
      'inner_semicircle_radius_ft',17,
      'inner_semicircle_area_sqft',453.960907,
      'estimated_spiral_path_area_sqft',324.167196,
      'area_status','working_geometry_estimate',
      'planting_use','perennial pockets and lines inside spiral'
    )
  ) on conflict (farm_id, stable_key) do update
  set label=excluded.label,
      object_type=excluded.object_type,
      object_mode=excluded.object_mode,
      length_ft=excluded.length_ft,
      width_ft=excluded.width_ft,
      area_sqft=excluded.area_sqft,
      guest_visible=excluded.guest_visible,
      sort_order=excluded.sort_order,
      metadata=atlas.growing_objects.metadata || excluded.metadata,
      updated_at=now();

  update atlas.growing_objects
  set length_ft=8.5,
      width_ft=8,
      area_sqft=68,
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'dimension_source','user_report_20260711',
        'bed_count',2,
        'individual_bed_length_ft',8.5,
        'individual_bed_width_ft',4,
        'individual_bed_area_sqft',34,
        'total_bed_area_sqft',68
      ),
      updated_at=now()
  where stable_key='berry_walk_rail_tie_tulip_area';

  insert into atlas.growing_objects (
    farm_id, zone_id, stable_key, label, object_type, object_mode,
    length_ft, width_ft, area_sqft, guest_visible, sort_order, metadata
  ) values
    (v_farm, v_obw_zone, 'berry_walk_rail_tie_bed_north', 'Berry Walk Rail-Tie Bed North', 'bed', 'annual_production', 8.5, 4, 34, true, 70,
      jsonb_build_object('dimension_source','user_report_20260711','dimension_status','verified','planned_use','florist tulips / cottage succession')),
    (v_farm, v_obw_zone, 'berry_walk_rail_tie_bed_south', 'Berry Walk Rail-Tie Bed South', 'bed', 'annual_production', 8.5, 4, 34, true, 71,
      jsonb_build_object('dimension_source','user_report_20260711','dimension_status','verified','planned_use','florist tulips / cottage succession'))
  on conflict (farm_id, stable_key) do update
  set label=excluded.label,
      object_type=excluded.object_type,
      object_mode=excluded.object_mode,
      length_ft=excluded.length_ft,
      width_ft=excluded.width_ft,
      area_sqft=excluded.area_sqft,
      guest_visible=excluded.guest_visible,
      sort_order=excluded.sort_order,
      metadata=atlas.growing_objects.metadata || excluded.metadata,
      updated_at=now();

  update atlas.zones
  set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'outer_semicircle_radius_ft',25,
      'outer_semicircle_area_sqft',981.747704,
      'crescent_max_width_ft',8,
      'crescent_bed_area_sqft',527.787566,
      'spiral_path_width_ft',2,
      'spiral_turn_count',3,
      'spiral_path_area_sqft_estimate',324.167196,
      'spiral_perennial_pocket_area_sqft_estimate',129.793711,
      'rail_tie_bed_count',2,
      'rail_tie_bed_size_label','8.5 ft x 4 ft',
      'rail_tie_bed_total_sqft',68,
      'geometry_model_date','2026-07-11'
    ),
    updated_at=now()
  where stable_key='original_berry_walk';

  update atlas.growing_objects g
  set object_type='bed',
      object_mode='hospitality_showcase',
      length_ft=15,
      width_ft=4,
      area_sqft=60,
      guest_visible=true,
      metadata=coalesce(g.metadata,'{}'::jsonb) || jsonb_build_object(
        'dimension_source','user_confirmed_20260711',
        'dimension_status','verified',
        'shape_note','oval approximated by measured 4 ft x 15 ft bed footprint'
      ),
      updated_at=now()
  from atlas.zones z
  where g.zone_id=z.id and z.stable_key='redbud_islands';

  update atlas.zones
  set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'bed_count',2,
      'bed_length_ft',15,
      'bed_width_ft',4,
      'bed_area_sqft_each',60,
      'total_growing_area_sqft',120,
      'layout_verified_date','2026-07-11'
    ),
    updated_at=now()
  where stable_key='redbud_islands';
end $$;
