begin;

alter table atlas.community_events
  drop constraint if exists community_events_event_kind_check;

alter table atlas.community_events
  add constraint community_events_event_kind_check
  check (event_kind = any (array[
    'free_community_morning'::text,
    'ticketed_seasonal_evening'::text,
    'special_fifth_thursday'::text,
    'church_group_visit'::text,
    'family_field_club_session'::text
  ]));

create table if not exists atlas.community_registration_offerings (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  program_id uuid references atlas.community_programs(id) on delete cascade,
  event_id uuid references atlas.community_events(id) on delete cascade,
  stable_key text not null,
  title text not null,
  registration_type text not null check (registration_type = any (array['household_participation'::text,'individual_participation'::text,'vendor'::text])),
  status text not null default 'draft' check (status = any (array['draft'::text,'open'::text,'closed'::text,'cancelled'::text])),
  opens_at timestamptz,
  closes_at timestamptz,
  fee_amount numeric(10,2) not null default 0 check (fee_amount >= 0),
  fee_currency text not null default 'USD',
  fee_basis text not null check (fee_basis = any (array['per_household'::text,'per_person'::text,'per_vendor'::text,'per_booth'::text,'free'::text])),
  registration_scope text not null check (registration_scope = any (array['entire_program'::text,'single_event'::text])),
  public_description text,
  terms_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key),
  check (program_id is not null or event_id is not null),
  check (not (fee_basis = 'free' and fee_amount <> 0))
);

create table if not exists atlas.community_registrations (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references atlas.community_registration_offerings(id) on delete cascade,
  registration_number text not null unique,
  registrant_type text not null check (registrant_type = any (array['household'::text,'individual'::text,'vendor'::text])),
  status text not null default 'started' check (status = any (array['started'::text,'submitted'::text,'payment_pending'::text,'confirmed'::text,'cancelled'::text,'refunded'::text])),
  primary_name text not null,
  primary_email text not null,
  primary_phone text,
  household_name text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists atlas.community_registration_participants (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references atlas.community_registrations(id) on delete cascade,
  display_name text not null,
  participant_role text not null default 'family_member' check (participant_role = any (array['adult'::text,'child'::text,'family_member'::text,'other_family_member'::text])),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists atlas.community_registration_payments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references atlas.community_registrations(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'USD',
  status text not null default 'pending' check (status = any (array['pending'::text,'paid'::text,'failed'::text,'refunded'::text,'partially_refunded'::text])),
  payment_processor text,
  external_payment_id text,
  paid_at timestamptz,
  refunded_at timestamptz,
  beneficiary_type text,
  beneficiary_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_registration_offerings_program_idx
  on atlas.community_registration_offerings(program_id);
create index if not exists community_registration_offerings_event_idx
  on atlas.community_registration_offerings(event_id);
create index if not exists community_registrations_offering_idx
  on atlas.community_registrations(offering_id, created_at desc);
create unique index if not exists community_registrations_active_email_uq
  on atlas.community_registrations(offering_id, lower(primary_email))
  where status not in ('cancelled','refunded');
create index if not exists community_registration_participants_registration_idx
  on atlas.community_registration_participants(registration_id);
create index if not exists community_registration_payments_registration_idx
  on atlas.community_registration_payments(registration_id, created_at desc);

alter table atlas.community_registration_offerings enable row level security;
alter table atlas.community_registrations enable row level security;
alter table atlas.community_registration_participants enable row level security;
alter table atlas.community_registration_payments enable row level security;

revoke all on atlas.community_registration_offerings from anon, authenticated;
revoke all on atlas.community_registrations from anon, authenticated;
revoke all on atlas.community_registration_participants from anon, authenticated;
revoke all on atlas.community_registration_payments from anon, authenticated;

grant all on atlas.community_registration_offerings to service_role;
grant all on atlas.community_registrations to service_role;
grant all on atlas.community_registration_participants to service_role;
grant all on atlas.community_registration_payments to service_role;

create or replace function atlas.set_community_registration_updated_at_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, atlas
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger community_registration_offerings_updated_at
before update on atlas.community_registration_offerings
for each row execute function atlas.set_community_registration_updated_at_v1();

create trigger community_registrations_updated_at
before update on atlas.community_registrations
for each row execute function atlas.set_community_registration_updated_at_v1();

create trigger community_registration_participants_updated_at
before update on atlas.community_registration_participants
for each row execute function atlas.set_community_registration_updated_at_v1();

create trigger community_registration_payments_updated_at
before update on atlas.community_registration_payments
for each row execute function atlas.set_community_registration_updated_at_v1();

create or replace function atlas.get_public_registration_offering_v1(p_stable_key text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_offering atlas.community_registration_offerings%rowtype;
  v_program atlas.community_programs%rowtype;
  v_farm atlas.farms%rowtype;
  v_events jsonb;
begin
  select * into v_offering
  from atlas.community_registration_offerings o
  where o.stable_key = trim(p_stable_key)
    and o.status = 'open'
    and (o.opens_at is null or o.opens_at <= now())
    and (o.closes_at is null or o.closes_at >= now())
  limit 1;

  if not found then
    return null;
  end if;

  if v_offering.program_id is not null then
    select * into v_program from atlas.community_programs where id = v_offering.program_id;
  end if;
  select * into v_farm from atlas.farms where id = v_offering.farm_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', e.event_date,
    'start_time', to_char(e.start_local_time, 'HH24:MI'),
    'end_time', to_char(e.end_local_time, 'HH24:MI'),
    'title', e.title
  ) order by e.event_date, e.start_local_time), '[]'::jsonb)
  into v_events
  from atlas.community_events e
  where e.program_id = v_offering.program_id
    and e.status in ('planned','scheduled');

  return jsonb_build_object(
    'stable_key', v_offering.stable_key,
    'title', v_offering.title,
    'registration_type', v_offering.registration_type,
    'fee_amount', v_offering.fee_amount,
    'fee_currency', v_offering.fee_currency,
    'fee_basis', v_offering.fee_basis,
    'registration_scope', v_offering.registration_scope,
    'public_description', v_offering.public_description,
    'terms_version', v_offering.terms_version,
    'program_title', v_program.title,
    'farm_name', v_farm.name,
    'timezone_name', coalesce(v_program.timezone_name, 'America/Chicago'),
    'events', v_events,
    'public', coalesce(v_offering.metadata->'public', '{}'::jsonb)
  );
end;
$$;

create or replace function atlas.submit_public_household_registration_v1(
  p_offering_key text,
  p_primary_name text,
  p_primary_email text,
  p_primary_phone text default null,
  p_household_name text default null,
  p_participant_names text[] default '{}'::text[],
  p_terms_accepted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_offering atlas.community_registration_offerings%rowtype;
  v_registration atlas.community_registrations%rowtype;
  v_name text := trim(coalesce(p_primary_name,''));
  v_email text := lower(trim(coalesce(p_primary_email,'')));
  v_phone text := nullif(trim(coalesce(p_primary_phone,'')), '');
  v_household text := nullif(trim(coalesce(p_household_name,'')), '');
  v_participant text;
  v_registration_number text;
  v_payment_status text;
begin
  if not p_terms_accepted then
    raise exception using errcode='22023', message='Participation terms must be accepted.';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception using errcode='22023', message='Primary adult name is required.';
  end if;
  if length(v_email) < 5 or length(v_email) > 254 or position('@' in v_email) < 2 then
    raise exception using errcode='22023', message='A valid email address is required.';
  end if;
  if v_phone is not null and length(v_phone) > 40 then
    raise exception using errcode='22023', message='Phone number is too long.';
  end if;
  if v_household is not null and length(v_household) > 120 then
    raise exception using errcode='22023', message='Household name is too long.';
  end if;

  select * into v_offering
  from atlas.community_registration_offerings o
  where o.stable_key = trim(p_offering_key)
    and o.registration_type = 'household_participation'
    and o.status = 'open'
    and (o.opens_at is null or o.opens_at <= now())
    and (o.closes_at is null or o.closes_at >= now())
  limit 1;

  if not found then
    raise exception using errcode='P0002', message='Registration is not currently open for this program.';
  end if;

  if exists (
    select 1 from atlas.community_registrations r
    where r.offering_id = v_offering.id
      and lower(r.primary_email) = v_email
      and r.status not in ('cancelled','refunded')
  ) then
    raise exception using errcode='23505', message='This email is already registered for this program.';
  end if;

  v_registration_number := 'ELM-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  v_payment_status := case when v_offering.fee_amount > 0 then 'payment_pending' else 'confirmed' end;

  insert into atlas.community_registrations (
    offering_id, registration_number, registrant_type, status,
    primary_name, primary_email, primary_phone, household_name,
    submitted_at, confirmed_at, metadata
  ) values (
    v_offering.id, v_registration_number, 'household', v_payment_status,
    v_name, v_email, v_phone, v_household,
    now(), case when v_offering.fee_amount = 0 then now() else null end,
    jsonb_build_object(
      'source','public_registration_v1',
      'terms_version',v_offering.terms_version,
      'terms_accepted_at',now()
    )
  ) returning * into v_registration;

  insert into atlas.community_registration_participants (registration_id, display_name, participant_role)
  values (v_registration.id, v_name, 'adult');

  foreach v_participant in array coalesce(p_participant_names, '{}'::text[])
  loop
    v_participant := trim(v_participant);
    if v_participant <> '' then
      if length(v_participant) > 120 then
        raise exception using errcode='22023', message='Participant name is too long.';
      end if;
      insert into atlas.community_registration_participants (registration_id, display_name, participant_role)
      values (v_registration.id, v_participant, 'family_member');
    end if;
  end loop;

  if v_offering.fee_amount > 0 then
    insert into atlas.community_registration_payments (
      registration_id, amount, currency, status,
      beneficiary_type, beneficiary_reference, metadata
    ) values (
      v_registration.id,
      v_offering.fee_amount,
      v_offering.fee_currency,
      'pending',
      nullif(v_offering.metadata->>'revenue_beneficiary_type',''),
      nullif(v_offering.metadata->>'revenue_beneficiary_reference',''),
      jsonb_build_object(
        'beneficiary_status', coalesce(v_offering.metadata->>'revenue_beneficiary_status','unresolved'),
        'payment_integration_status', coalesce(v_offering.metadata->>'payment_integration_status','not_configured')
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'registration_id', v_registration.id,
    'registration_number', v_registration.registration_number,
    'status', v_registration.status,
    'payment_status', case when v_offering.fee_amount > 0 then 'pending' else 'not_required' end,
    'amount_due', v_offering.fee_amount,
    'currency', v_offering.fee_currency,
    'message', case
      when v_offering.fee_amount > 0 then 'Registration received. Payment instructions will follow.'
      else 'Registration confirmed.'
    end
  );
end;
$$;

revoke all on function atlas.get_public_registration_offering_v1(text) from public;
revoke all on function atlas.submit_public_household_registration_v1(text,text,text,text,text,text[],boolean) from public;
grant execute on function atlas.get_public_registration_offering_v1(text) to anon, authenticated, service_role;
grant execute on function atlas.submit_public_household_registration_v1(text,text,text,text,text,text[],boolean) to anon, authenticated, service_role;

insert into atlas.projects (
  farm_id, organization_id, stable_key, title, status, goal_text,
  workstream, project_kind, outcome_text, current_milestone,
  health_status, target_date, last_movement_at, portfolio_type,
  reality_state, reality_state_reason, metadata
)
select
  f.id, f.organization_id, 'elm_family_field_club', 'Elm Family Field Club', 'active',
  'Create a repeatable family sports program at Elm that gives homeschool families a reason to gather at the farm on weekday evenings, with parents participating rather than sitting on the sidelines.',
  'hospitality', 'farm',
  'Elm has a repeatable family field-sports program that can run in bounded seasons without being reinvented each week. Families come to Elm to play together, build relationships, spend an evening outside, and experience the farm through sunset.',
  'Launch and fill the first six-week Elm Family Ultimate season for Fall 2026.',
  'moving', '2026-09-08', now(), 'program', 'making_real',
  'The first season, audience, six-week structure, household price, and physical experience are defined; registration and host confirmation are the current execution edge.',
  jsonb_build_object(
    'created_from','owner_direction_20260813',
    'program_family','Elm Family Field Club',
    'first_season','Elm Family Ultimate — Fall 2026',
    'worker_owner_boundary','Anna is not the program host or owner.',
    'host_status','unresolved',
    'host_candidate','Dan Langenberg'
  )
from atlas.farms f
where f.stable_key='elm_farm'
on conflict (organization_id, stable_key) do update set
  title=excluded.title,
  status=excluded.status,
  goal_text=excluded.goal_text,
  outcome_text=excluded.outcome_text,
  current_milestone=excluded.current_milestone,
  health_status=excluded.health_status,
  target_date=excluded.target_date,
  last_movement_at=excluded.last_movement_at,
  portfolio_type=excluded.portfolio_type,
  reality_state=excluded.reality_state,
  reality_state_reason=excluded.reality_state_reason,
  metadata=atlas.projects.metadata || excluded.metadata,
  updated_at=now();

insert into atlas.community_programs (
  farm_id, stable_key, title, active, timezone_name, cadence, metadata
)
select
  f.id,
  'elm_family_field_club',
  'Elm Family Field Club',
  true,
  'America/Chicago',
  jsonb_build_object(
    'kind','seasonal_series',
    'first_season','fall_2026_ultimate',
    'weekday','Tuesday',
    'session_start_local','18:00',
    'session_end_local','19:30'
  ),
  jsonb_build_object(
    'audience','homeschool families',
    'participation_model','parents and children participate simultaneously on adjacent play areas',
    'public_age_range',null,
    'public_capacity',null,
    'sunset_is_part_of_experience',true,
    'first_sport','Ultimate Frisbee',
    'season_fee_per_household',60,
    'host_status','unresolved',
    'host_candidate','Dan Langenberg',
    'anna_program_owner',false,
    'source','owner_direction_20260813'
  )
from atlas.farms f
where f.stable_key='elm_farm'
on conflict (farm_id, stable_key) do update set
  title=excluded.title,
  active=excluded.active,
  timezone_name=excluded.timezone_name,
  cadence=excluded.cadence,
  metadata=atlas.community_programs.metadata || excluded.metadata,
  updated_at=now();

insert into atlas.community_events (
  farm_id, program_id, stable_key, title, event_kind,
  event_date, start_local_time, end_local_time, timezone_name,
  status, visibility_scope, capacity, metadata
)
select
  p.farm_id,
  p.id,
  'elm_family_ultimate_2026_' || to_char(d.event_date,'MM_DD'),
  'Elm Family Ultimate',
  'family_field_club_session',
  d.event_date,
  time '18:00',
  time '19:30',
  'America/Chicago',
  'planned',
  'farm_shared',
  null,
  jsonb_build_object(
    'season','fall_2026',
    'sport','Ultimate Frisbee',
    'household_program',true,
    'adult_and_child_parallel_play',true,
    'sunset_is_part_of_experience',true,
    'time_source','working_public_time_from_program_design_20260813'
  )
from atlas.community_programs p
cross join (values
  (date '2026-09-08'),
  (date '2026-09-15'),
  (date '2026-09-22'),
  (date '2026-09-29'),
  (date '2026-10-06'),
  (date '2026-10-13')
) as d(event_date)
where p.stable_key='elm_family_field_club'
on conflict (farm_id, stable_key) do update set
  title=excluded.title,
  event_kind=excluded.event_kind,
  event_date=excluded.event_date,
  start_local_time=excluded.start_local_time,
  end_local_time=excluded.end_local_time,
  timezone_name=excluded.timezone_name,
  status=excluded.status,
  visibility_scope=excluded.visibility_scope,
  capacity=null,
  metadata=atlas.community_events.metadata || excluded.metadata,
  updated_at=now();

insert into atlas.community_registration_offerings (
  farm_id, program_id, stable_key, title, registration_type, status,
  opens_at, closes_at, fee_amount, fee_currency, fee_basis,
  registration_scope, public_description, terms_version, metadata
)
select
  p.farm_id,
  p.id,
  'elm_family_ultimate_fall_2026',
  'Elm Family Ultimate — Fall 2026',
  'household_participation',
  'open',
  now(),
  timestamptz '2026-09-08 18:00:00-05',
  60.00,
  'USD',
  'per_household',
  'entire_program',
  'Six Tuesday evenings at Elm Farm for homeschool families. Parents play Ultimate on one side while kids play on the other. Beginners are welcome; the point is a regular active family evening on the farm as the sun goes down.',
  'elm_family_field_club_v1',
  jsonb_build_object(
    'revenue_beneficiary_type','host',
    'revenue_beneficiary_reference',null,
    'revenue_beneficiary_status','unresolved_until_host_accepts',
    'elm_venue_share',0,
    'payment_integration_status','not_configured',
    'host_status','unresolved',
    'host_candidate','Dan Langenberg',
    'public',jsonb_build_object(
      'location_label','Elm Farm • Marshfield, Missouri',
      'audience','Homeschool families',
      'headline','Parents play. Kids play.',
      'experience_note','A field full of families playing together while the sun goes down at Elm.',
      'what_to_bring',jsonb_build_array('Water bottles','Comfortable shoes for a grass field','A flying disc if you already have one — Elm will have extras'),
      'payment_note','Registration is recorded now; payment instructions will follow once the host/payment path is finalized.',
      'age_range_published',false,
      'capacity_published',false
    )
  )
from atlas.community_programs p
where p.stable_key='elm_family_field_club'
on conflict (farm_id, stable_key) do update set
  program_id=excluded.program_id,
  title=excluded.title,
  registration_type=excluded.registration_type,
  status=excluded.status,
  opens_at=excluded.opens_at,
  closes_at=excluded.closes_at,
  fee_amount=excluded.fee_amount,
  fee_currency=excluded.fee_currency,
  fee_basis=excluded.fee_basis,
  registration_scope=excluded.registration_scope,
  public_description=excluded.public_description,
  terms_version=excluded.terms_version,
  metadata=atlas.community_registration_offerings.metadata || excluded.metadata,
  updated_at=now();

commit;