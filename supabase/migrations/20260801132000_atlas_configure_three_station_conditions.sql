-- Configure the three surrounding weather-station locations used by Atlas
-- for distance-weighted current conditions, rainfall history, and rain forecast.

update atlas.farms
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'condition_station_method', 'inverse_distance_weighted_three_point',
  'condition_station_points', jsonb_build_array(
    jsonb_build_object(
      'key', 'klbo',
      'station_id', 'KLBO',
      'label', 'Lebanon · KLBO',
      'latitude', 37.6483219,
      'longitude', -92.6524308
    ),
    jsonb_build_object(
      'key', 'ksgf',
      'station_id', 'KSGF',
      'label', 'Springfield · KSGF',
      'latitude', 37.23983,
      'longitude', -93.38995
    ),
    jsonb_build_object(
      'key', 'kuno',
      'station_id', 'KUNO',
      'label', 'West Plains · KUNO',
      'latitude', 36.87913,
      'longitude', -91.90523
    )
  ),
  'condition_station_note',
    'Current weather uses NWS observations when fresh; rainfall history and forecast use weather-model readings at the same three station locations.'
),
updated_at = now()
where stable_key = 'elm_farm';

update atlas.farms
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'condition_station_method', 'inverse_distance_weighted_three_point',
  'condition_station_points', jsonb_build_array(
    jsonb_build_object(
      'key', 'kmhe',
      'station_id', 'KMHE',
      'label', 'Mitchell · KMHE',
      'latitude', 43.7748219,
      'longitude', -98.0386153
    ),
    jsonb_build_object(
      'key', 'kfsd',
      'station_id', 'KFSD',
      'label', 'Sioux Falls · KFSD',
      'latitude', 43.57751,
      'longitude', -96.75387
    ),
    jsonb_build_object(
      'key', 'kmds',
      'station_id', 'KMDS',
      'label', 'Madison · KMDS',
      'latitude', 44.0164167,
      'longitude', -97.0856111
    )
  ),
  'condition_station_note',
    'Current weather uses NWS observations when fresh; rainfall history and forecast use weather-model readings at the same three station locations.'
),
updated_at = now()
where stable_key = 'waiting_room_farm';
