update atlas.community_registration_offerings
set metadata = jsonb_set(
  metadata,
  '{public}',
  coalesce(metadata->'public','{}'::jsonb) || jsonb_build_object(
    'location_label','Elm Farm • Marshfield, Missouri',
    'audience','Homeschool families',
    'headline','Parents play. Kids play.',
    'experience_note','A field full of families playing together while the sun goes down at Elm.',
    'what_to_bring',jsonb_build_array(
      'Water bottles',
      'Comfortable shoes for a grass field',
      'A flying disc if you already have one — Elm will have extras'
    ),
    'payment_note','Registration is recorded now; payment instructions will follow once the host/payment path is finalized.',
    'age_range_published',false,
    'capacity_published',false
  ),
  true
), updated_at = now()
where stable_key='elm_family_ultimate_fall_2026';
