insert into atlas.community_registration_offerings(
  farm_id,program_id,stable_key,title,registration_type,status,opens_at,closes_at,
  fee_amount,fee_currency,fee_basis,registration_scope,public_description,terms_version,metadata
)
select
  p.farm_id,p.id,'elm_family_ultimate_fall_2026','Elm Family Ultimate — Fall 2026',
  'household_participation','open',now(),timestamptz '2026-09-08 18:00:00-05',
  60.00,'USD','per_household','entire_program',
  'Six Tuesday evenings at Elm Farm for homeschool families. Parents play Ultimate while kids play nearby. Beginners are welcome, and sunset is part of the farm evening.',
  'elm_family_field_club_v1',
  jsonb_build_object(
    'revenue_beneficiary_type','host',
    'revenue_beneficiary_status','unresolved_until_host_accepts',
    'elm_venue_share',0,
    'payment_integration_status','not_configured',
    'host_status','unresolved',
    'public',jsonb_build_object(
      'location_label','Elm Farm • Marshfield, Missouri',
      'headline','Parents play. Kids play.',
      'capacity_published',false,
      'age_range_published',false
    )
  )
from atlas.community_programs p
where p.stable_key='elm_family_field_club'
on conflict (farm_id,stable_key) do update set
  program_id=excluded.program_id,title=excluded.title,status=excluded.status,
  opens_at=excluded.opens_at,closes_at=excluded.closes_at,fee_amount=excluded.fee_amount,
  fee_basis=excluded.fee_basis,registration_scope=excluded.registration_scope,
  public_description=excluded.public_description,terms_version=excluded.terms_version,
  metadata=atlas.community_registration_offerings.metadata || excluded.metadata,updated_at=now();
