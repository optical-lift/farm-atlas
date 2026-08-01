begin;

create table if not exists atlas.farm_rain_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  observation_date date not null,
  amount_in numeric(7,3) not null check (amount_in >= 0 and amount_in <= 30),
  source_type text not null default 'farm_gauge' check (
    source_type in ('farm_gauge', 'manual_report', 'nearby_station', 'radar_estimate')
  ),
  note text,
  recorded_by_user_id uuid not null references auth.users(id) on delete restrict,
  recorded_by_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists farm_rain_observations_farm_date_idx
  on atlas.farm_rain_observations (farm_id, observation_date desc, created_at desc);

create index if not exists farm_rain_observations_recorded_membership_idx
  on atlas.farm_rain_observations (recorded_by_membership_id)
  where recorded_by_membership_id is not null;

alter table atlas.farm_rain_observations enable row level security;

revoke all on table atlas.farm_rain_observations from anon;
revoke insert, update, delete on table atlas.farm_rain_observations from authenticated;
grant select on table atlas.farm_rain_observations to authenticated;
grant all on table atlas.farm_rain_observations to service_role;

create policy farm_rain_observations_read_member
  on atlas.farm_rain_observations
  for select
  to authenticated
  using (atlas.is_farm_member(farm_id));

create or replace function atlas.record_farm_rain_observation_v1(
  p_farm_id uuid,
  p_observation_date date,
  p_amount_in numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
  v_row atlas.farm_rain_observations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  if p_observation_date is null then
    raise exception 'Observation date is required.' using errcode = '22004';
  end if;

  if p_amount_in is null or p_amount_in < 0 or p_amount_in > 30 then
    raise exception 'Rain amount must be between 0 and 30 inches.' using errcode = '22023';
  end if;

  v_membership_id := atlas.current_membership_id(p_farm_id);

  insert into atlas.farm_rain_observations (
    farm_id,
    observation_date,
    amount_in,
    source_type,
    note,
    recorded_by_user_id,
    recorded_by_membership_id
  ) values (
    p_farm_id,
    p_observation_date,
    round(p_amount_in::numeric, 3),
    'farm_gauge',
    nullif(btrim(coalesce(p_note, '')), ''),
    v_user_id,
    v_membership_id
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'farm_id', v_row.farm_id,
    'observation_date', v_row.observation_date,
    'amount_in', v_row.amount_in,
    'source_type', v_row.source_type,
    'recorded_at', v_row.created_at
  );
end
$function$;

revoke all on function atlas.record_farm_rain_observation_v1(uuid, date, numeric, text) from public;
revoke all on function atlas.record_farm_rain_observation_v1(uuid, date, numeric, text) from anon;
grant execute on function atlas.record_farm_rain_observation_v1(uuid, date, numeric, text) to authenticated;
grant execute on function atlas.record_farm_rain_observation_v1(uuid, date, numeric, text) to service_role;

insert into atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  reviewed_at
) values (
  'atlas.record_farm_rain_observation_v1(uuid, date, numeric, text)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'source', 'farm_conditions_lunar_clock_v1',
    'call_site', 'Farm Conditions Home rain-gauge form',
    'authorization', 'active same-farm membership',
    'reviewed_date', '2026-08-01'
  ),
  now()
)
on conflict (signature) do update set
  classification = excluded.classification,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  authenticated_execute_expected = excluded.authenticated_execute_expected,
  security_definer_expected = excluded.security_definer_expected,
  service_execute_expected = excluded.service_execute_expected,
  caller_count = excluded.caller_count,
  policy_reference_count = excluded.policy_reference_count,
  evidence = excluded.evidence,
  reviewed_at = excluded.reviewed_at;

update atlas.farms
set metadata = metadata || jsonb_build_object(
  'condition_latitude', 37.3387,
  'condition_longitude', -92.9071,
  'condition_location_label', 'Marshfield area',
  'timezone', 'America/Chicago',
  'utc_standard_offset_hours', -6,
  'uses_us_daylight_time', true,
  'lunar_rule_profile', 'elm_almanac_v1',
  'moon_sign_basis', 'tropical_local_noon'
),
updated_at = now()
where stable_key = 'elm_farm';

commit;