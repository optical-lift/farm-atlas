update atlas.farms
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'location_label', 'Marshfield, MO',
  'city', 'Marshfield',
  'state', 'MO',
  'frost_status', 'known',
  'frost_boundary_month', 11,
  'frost_boundary_day', 1,
  'frost_note', 'Elm Farm working first-killing-freeze boundary.'
),
updated_at = now()
where stable_key = 'elm_farm';

update atlas.farms
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'location_label', 'Spencer, SD',
  'city', 'Spencer',
  'state', 'SD',
  'frost_status', 'unknown',
  'frost_boundary_date', null,
  'frost_note', 'First growing season at this farm; frost timing has not been established yet.'
),
updated_at = now()
where stable_key = 'waiting_room_farm';
