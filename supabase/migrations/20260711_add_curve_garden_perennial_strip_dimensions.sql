with curve_zone as (
  select id, farm_id
  from atlas.zones
  where stable_key = 'curve_garden'
  limit 1
), upsert_strip as (
  insert into atlas.growing_objects (
    farm_id, zone_id, stable_key, label, object_type, object_mode,
    length_ft, width_ft, area_sqft, guest_visible, sort_order, metadata
  )
  select
    farm_id,
    id,
    'curve_garden_perennial_strip',
    'Curve Garden Perennial Strip',
    'bed',
    'perennial_nursery',
    50,
    2,
    100,
    true,
    100,
    jsonb_build_object(
      'role', 'perennial_border',
      'dimension_source', 'user_report_20260711',
      'size_label', '2 ft x 50 ft',
      'notes', 'Continuous curved perennial planting strip behind/along the Curve Garden arch beds.'
    )
  from curve_zone
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
    metadata = atlas.growing_objects.metadata || excluded.metadata,
    updated_at = now()
  returning zone_id
)
update atlas.zones z
set metadata = z.metadata || jsonb_build_object(
  'perennial_strip_length_ft', 50,
  'perennial_strip_width_ft', 2,
  'perennial_strip_area_sqft', 100,
  'mapped_growing_area_sqft', 166.666666,
  'dimension_source_updated_at', '2026-07-11'
),
updated_at = now()
where z.id in (select zone_id from upsert_strip);
