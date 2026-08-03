create table if not exists atlas.community_programs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  stable_key text not null,
  title text not null,
  active boolean not null default true,
  timezone_name text not null default 'America/Chicago',
  cadence jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key)
);

create table if not exists atlas.community_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  program_id uuid not null references atlas.community_programs(id) on delete cascade,
  stable_key text not null,
  title text not null,
  event_kind text not null check (event_kind in ('free_community_morning', 'ticketed_seasonal_evening', 'special_fifth_thursday')),
  event_date date not null,
  start_local_time time not null,
  end_local_time time not null,
  timezone_name text not null default 'America/Chicago',
  status text not null default 'planned' check (status in ('planned', 'scheduled', 'cancelled', 'complete')),
  visibility_scope text not null default 'farm_shared' check (visibility_scope in ('owner', 'management', 'farm_shared')),
  capacity integer null check (capacity is null or capacity > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key),
  check (end_local_time > start_local_time)
);

create index if not exists community_events_farm_date_idx
  on atlas.community_events(farm_id, event_date, start_local_time);

alter table atlas.community_programs enable row level security;
alter table atlas.community_events enable row level security;
revoke all on table atlas.community_programs from public, anon, authenticated;
revoke all on table atlas.community_events from public, anon, authenticated;
grant select, insert, update, delete on table atlas.community_programs to service_role;
grant select, insert, update, delete on table atlas.community_events to service_role;

with elm as (
  select f.id as farm_id, f.organization_id
  from atlas.farms f
  where f.stable_key = 'elm_farm'
), owner_member as (
  select fm.user_id
  from atlas.farm_memberships fm
  join elm on elm.farm_id = fm.farm_id
  where fm.active = true and fm.role = 'owner'
  order by fm.created_at
  limit 1
)
insert into atlas.community_programs(
  farm_id, stable_key, title, active, timezone_name, cadence, metadata, created_by_user_id
)
select
  elm.farm_id,
  'thursdays_at_elm',
  'Thursdays at Elm',
  true,
  'America/Chicago',
  jsonb_build_object(
    'weekday', 4,
    'free_mornings', jsonb_build_object(
      'week_ordinals', jsonb_build_array(1, 3),
      'start_local_time', '09:30',
      'end_local_time', '11:30',
      'access', 'free community flower-farming morning'
    ),
    'ticketed_evenings', jsonb_build_object(
      'week_ordinals', jsonb_build_array(2, 4),
      'start_local_time', '18:30',
      'end_local_time', '20:30',
      'access', 'ticketed seasonal gathering'
    ),
    'fifth_thursday', 'optional special, private event, or rest'
  ),
  jsonb_build_object(
    'source', 'Thursdays at Elm Program Brand and Operations Handoff',
    'installed_by', 'owner_task:build_community_thursday_event_bell_flow',
    'installed_at', now()
  ),
  owner_member.user_id
from elm cross join owner_member
on conflict (farm_id, stable_key) do update
set title = excluded.title,
    active = excluded.active,
    timezone_name = excluded.timezone_name,
    cadence = excluded.cadence,
    metadata = atlas.community_programs.metadata || excluded.metadata,
    updated_at = now();

with program as (
  select cp.id as program_id, cp.farm_id, cp.created_by_user_id
  from atlas.community_programs cp
  join atlas.farms f on f.id = cp.farm_id
  where f.stable_key = 'elm_farm' and cp.stable_key = 'thursdays_at_elm'
), thursdays as (
  select
    d::date as event_date,
    (((extract(day from d)::integer - 1) / 7) + 1)::integer as week_ordinal
  from generate_series(date '2026-08-01', date '2026-12-31', interval '1 day') d
  where extract(dow from d)::integer = 4
), shaped as (
  select
    program.*,
    thursdays.event_date,
    thursdays.week_ordinal,
    case when thursdays.week_ordinal in (1, 3)
      then 'free_community_morning'
      else 'ticketed_seasonal_evening'
    end as event_kind,
    case when thursdays.week_ordinal in (1, 3)
      then 'Come Flower Farm With Us'
      else 'Thursdays at Elm Seasonal Evening'
    end as title,
    case when thursdays.week_ordinal in (1, 3) then time '09:30' else time '18:30' end as start_time,
    case when thursdays.week_ordinal in (1, 3) then time '11:30' else time '20:30' end as end_time
  from program cross join thursdays
  where thursdays.week_ordinal in (1, 2, 3, 4)
)
insert into atlas.community_events(
  farm_id, program_id, stable_key, title, event_kind, event_date,
  start_local_time, end_local_time, timezone_name, status, visibility_scope,
  capacity, metadata, created_by_user_id
)
select
  shaped.farm_id,
  shaped.program_id,
  format('thursdays_at_elm_%s_%s', to_char(shaped.event_date, 'YYYY_MM_DD'),
    case when shaped.event_kind = 'free_community_morning' then 'morning' else 'evening' end),
  shaped.title,
  shaped.event_kind,
  shaped.event_date,
  shaped.start_time,
  shaped.end_time,
  'America/Chicago',
  case when shaped.event_date = date '2026-08-06' then 'scheduled' else 'planned' end,
  'farm_shared',
  null,
  case when shaped.event_kind = 'free_community_morning' then
    jsonb_build_object(
      'week_ordinal', shaped.week_ordinal,
      'public_format', 'free community flower-farming morning',
      'coffee_ready', true,
      'ticket_types', jsonb_build_array(
        jsonb_build_object('label', 'Community Visitor RSVP', 'price', 0, 'suggested_capacity', 25),
        jsonb_build_object('label', 'Make a Farm Bouquet', 'price', 25, 'suggested_capacity', 12),
        jsonb_build_object('label', 'Child Flower Cup', 'price', 10, 'suggested_capacity', 8)
      ),
      'public_rsvp_engine', 'WordPress/Amelia',
      'public_rsvp_setup_status', 'not asserted by Atlas',
      'source', 'Thursdays at Elm Program Brand and Operations Handoff'
    )
  else
    jsonb_build_object(
      'week_ordinal', shaped.week_ordinal,
      'public_format', 'ticketed seasonal gathering',
      'public_rsvp_engine', 'WordPress/Amelia',
      'public_rsvp_setup_status', 'not asserted by Atlas',
      'source', 'Thursdays at Elm Program Brand and Operations Handoff'
    )
  end,
  shaped.created_by_user_id
from shaped
on conflict (farm_id, stable_key) do update
set title = excluded.title,
    event_kind = excluded.event_kind,
    event_date = excluded.event_date,
    start_local_time = excluded.start_local_time,
    end_local_time = excluded.end_local_time,
    timezone_name = excluded.timezone_name,
    status = excluded.status,
    visibility_scope = excluded.visibility_scope,
    metadata = atlas.community_events.metadata || excluded.metadata,
    updated_at = now();
