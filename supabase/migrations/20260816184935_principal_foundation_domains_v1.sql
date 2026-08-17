-- Milestone 4: Principal Operating System foundation.
-- This migration establishes source domains and normalization contracts only.
-- It deliberately does NOT build Principal Clock arbitration.

create table atlas.principals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references atlas.organizations(id) on delete set null,
  stable_key text not null,
  name text not null,
  home_timezone text not null default 'America/Chicago',
  active_household_id uuid,
  status text not null default 'active' check (status in ('active','inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id),
  unique(stable_key)
);

create table atlas.portfolio_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete restrict,
  stable_key text not null,
  name text not null,
  unit_kind text not null check (unit_kind in ('farm','business','property','venture','strategic_option','program','other')),
  linked_farm_id uuid references atlas.farms(id) on delete set null,
  lifecycle_state text not null check (lifecycle_state in ('option','incubating','building','operating','growing','harvesting','paused','exiting','exited')),
  portfolio_role text not null,
  horizon text not null check (horizon in ('H1','H2','H3')),
  owner_id uuid not null references atlas.principals(id) on delete restrict,
  accountable_operator_id uuid references atlas.farm_memberships(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(organization_id,stable_key),
  unique(linked_farm_id)
);

create table atlas.households (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  stable_key text not null,
  name text not null,
  timezone text not null default 'America/Chicago',
  status text not null default 'active' check (status in ('active','inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(principal_id,stable_key)
);

alter table atlas.principals
  add constraint principals_active_household_id_fkey
  foreign key (active_household_id) references atlas.households(id) on delete set null;

create table atlas.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references atlas.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  relationship text,
  household_role text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table atlas.household_rhythms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references atlas.households(id) on delete cascade,
  stable_key text not null,
  area text not null,
  title text not null,
  cadence_rule text,
  next_window_start timestamptz,
  next_window_end timestamptz,
  expected_minutes integer check (expected_minutes is null or expected_minutes > 0),
  protection_level text not null default 'protected' check (protection_level in ('critical','protected','standard','optional')),
  floor_class smallint not null default 3 check (floor_class between 1 and 7),
  interruptibility text not null default 'interruptible' check (interruptibility in ('interruptible','low_interruptibility','should_not_interrupt')),
  principal_required boolean not null default true,
  consequence text,
  reason_for_floor text not null default 'Protected household rhythm.',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(household_id,stable_key),
  check (next_window_end is null or next_window_start is null or next_window_end > next_window_start)
);

create table atlas.household_zones (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references atlas.households(id) on delete cascade,
  zone_number smallint not null check (zone_number between 1 and 5),
  stable_key text not null,
  name text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(household_id,zone_number),
  unique(household_id,stable_key)
);

create table atlas.household_zone_items (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references atlas.household_zones(id) on delete cascade,
  stable_key text,
  title text not null,
  cadence_rule text,
  expected_minutes integer check (expected_minutes is null or expected_minutes > 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table atlas.household_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references atlas.households(id) on delete cascade,
  title text not null,
  event_kind text not null default 'family_commitment',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  fixed boolean not null default true,
  blocks_capacity boolean not null default true,
  expected_minutes integer check (expected_minutes is null or expected_minutes > 0),
  protection_level text not null default 'critical' check (protection_level in ('critical','protected','standard','optional')),
  floor_class smallint not null default 1 check (floor_class between 1 and 7),
  interruptibility text not null default 'should_not_interrupt' check (interruptibility in ('interruptible','low_interruptibility','should_not_interrupt')),
  principal_required boolean not null default true,
  consequence text,
  reason_for_floor text not null default 'Fixed household or family reality.',
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table atlas.owner_obligations (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  domain text not null,
  portfolio_unit_id uuid references atlas.portfolio_units(id) on delete set null,
  project_id uuid references atlas.projects(id) on delete set null,
  team_id uuid,
  title text not null,
  description text,
  horizon text check (horizon is null or horizon in ('H1','H2','H3')),
  becomes_relevant_at timestamptz,
  must_begin_by timestamptz,
  must_finish_by timestamptz,
  fixed_at timestamptz,
  expires_at timestamptz,
  preferred_window tstzrange,
  expected_minutes integer not null check (expected_minutes > 0),
  protection_level text not null check (protection_level in ('critical','protected','standard','optional')),
  floor_class smallint not null check (floor_class between 1 and 7),
  owner_capability text not null check (owner_capability in ('think','decide','approve','plan','review','create','communicate','fund')),
  interruptibility text not null default 'low_interruptibility' check (interruptibility in ('interruptible','low_interruptibility','should_not_interrupt')),
  delegable boolean not null default false,
  owner_required boolean not null default true,
  consequence_of_delay text not null,
  reason_for_floor text not null,
  status text not null default 'open' check (status in ('open','in_progress','paused','completed','cancelled')),
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (must_finish_by is null or must_begin_by is null or must_finish_by >= must_begin_by),
  check (expires_at is null or becomes_relevant_at is null or expires_at >= becomes_relevant_at)
);

create table atlas.operational_escalations (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  source_system text not null,
  source_type text not null,
  source_id text not null,
  portfolio_unit_id uuid references atlas.portfolio_units(id) on delete set null,
  escalation_kind text not null,
  current_state jsonb not null default '{}'::jsonb,
  threshold_crossed text not null,
  consequence text not null,
  owner_decision_required text not null,
  options_json jsonb not null default '[]'::jsonb,
  severity text not null check (severity in ('info','watch','material','critical')),
  floor_class smallint not null default 6 check (floor_class between 1 and 7),
  protection_level text not null default 'standard' check (protection_level in ('critical','protected','standard','optional')),
  interruptibility text not null default 'interruptible' check (interruptibility in ('interruptible','low_interruptibility','should_not_interrupt')),
  reason_for_floor text not null default 'Delegated operational exception crossed an explicit escalation threshold.',
  window_start timestamptz,
  window_end timestamptz,
  expected_owner_minutes integer check (expected_owner_minutes is null or expected_owner_minutes > 0),
  horizon text check (horizon is null or horizon in ('H1','H2','H3')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(source_system,source_type,source_id,escalation_kind),
  check (window_end is null or window_start is null or window_end > window_start)
);

create table atlas.principal_capacity_policies (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  stable_key text not null,
  name text not null,
  weekdays smallint[] not null,
  local_start time not null,
  local_end time not null,
  default_discretionary_minutes integer not null check (default_discretionary_minutes >= 0),
  maximum_planned_minutes integer not null check (maximum_planned_minutes >= 0),
  effective_from date not null,
  effective_through date,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(principal_id,stable_key,effective_from),
  check (local_end > local_start),
  check (effective_through is null or effective_through >= effective_from),
  check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  check (maximum_planned_minutes >= default_discretionary_minutes)
);

create table atlas.principal_capacity_blocks (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  title text not null,
  block_kind text not null check (block_kind in ('human_fixed','household','family','travel','appointment','protected_strategy','recovery','other')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocks_capacity boolean not null default true,
  floor_class smallint not null check (floor_class between 1 and 7),
  protection_level text not null check (protection_level in ('critical','protected','standard','optional')),
  interruptibility text not null default 'should_not_interrupt' check (interruptibility in ('interruptible','low_interruptibility','should_not_interrupt')),
  reason_for_floor text not null,
  source_type text,
  source_id text,
  consequence text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- Index the Principal retrieval paths and time windows.
create index portfolio_units_owner_horizon_idx on atlas.portfolio_units(owner_id,horizon,lifecycle_state) where archived_at is null;
create index household_members_household_active_idx on atlas.household_members(household_id) where active;
create index household_rhythms_household_window_idx on atlas.household_rhythms(household_id,next_window_start) where active;
create index household_events_household_starts_idx on atlas.household_events(household_id,starts_at);
create index owner_obligations_principal_status_window_idx on atlas.owner_obligations(principal_id,status,must_begin_by,must_finish_by);
create index operational_escalations_principal_status_window_idx on atlas.operational_escalations(principal_id,status,window_start,window_end);
create index principal_capacity_policies_principal_effective_idx on atlas.principal_capacity_policies(principal_id,effective_from,effective_through) where active;
create index principal_capacity_blocks_principal_time_idx on atlas.principal_capacity_blocks(principal_id,starts_at,ends_at) where blocks_capacity;

-- Keep normal mutable foundation rows auditable.
create trigger principals_set_updated_at before update on atlas.principals for each row execute function atlas.set_updated_at();
create trigger portfolio_units_set_updated_at before update on atlas.portfolio_units for each row execute function atlas.set_updated_at();
create trigger households_set_updated_at before update on atlas.households for each row execute function atlas.set_updated_at();
create trigger household_members_set_updated_at before update on atlas.household_members for each row execute function atlas.set_updated_at();
create trigger household_rhythms_set_updated_at before update on atlas.household_rhythms for each row execute function atlas.set_updated_at();
create trigger household_zones_set_updated_at before update on atlas.household_zones for each row execute function atlas.set_updated_at();
create trigger household_zone_items_set_updated_at before update on atlas.household_zone_items for each row execute function atlas.set_updated_at();
create trigger household_events_set_updated_at before update on atlas.household_events for each row execute function atlas.set_updated_at();
create trigger owner_obligations_set_updated_at before update on atlas.owner_obligations for each row execute function atlas.set_updated_at();
create trigger operational_escalations_set_updated_at before update on atlas.operational_escalations for each row execute function atlas.set_updated_at();
create trigger principal_capacity_policies_set_updated_at before update on atlas.principal_capacity_policies for each row execute function atlas.set_updated_at();
create trigger principal_capacity_blocks_set_updated_at before update on atlas.principal_capacity_blocks for each row execute function atlas.set_updated_at();

-- RLS: the Principal may read their own whole-life projection; app writes remain RPC/service controlled.
alter table atlas.principals enable row level security;
alter table atlas.portfolio_units enable row level security;
alter table atlas.households enable row level security;
alter table atlas.household_members enable row level security;
alter table atlas.household_rhythms enable row level security;
alter table atlas.household_zones enable row level security;
alter table atlas.household_zone_items enable row level security;
alter table atlas.household_events enable row level security;
alter table atlas.owner_obligations enable row level security;
alter table atlas.operational_escalations enable row level security;
alter table atlas.principal_capacity_policies enable row level security;
alter table atlas.principal_capacity_blocks enable row level security;

create policy principals_read_self on atlas.principals for select to authenticated using (user_id=auth.uid());
create policy portfolio_units_read_principal on atlas.portfolio_units for select to authenticated using (
  exists(select 1 from atlas.principals p where p.id=owner_id and p.user_id=auth.uid())
);
create policy households_read_principal on atlas.households for select to authenticated using (
  exists(select 1 from atlas.principals p where p.id=principal_id and p.user_id=auth.uid())
);
create policy household_members_read_principal on atlas.household_members for select to authenticated using (
  exists(select 1 from atlas.households h join atlas.principals p on p.id=h.principal_id where h.id=household_id and p.user_id=auth.uid())
);
create policy household_rhythms_read_principal on atlas.household_rhythms for select to authenticated using (
  exists(select 1 from atlas.households h join atlas.principals p on p.id=h.principal_id where h.id=household_id and p.user_id=auth.uid())
);
create policy household_zones_read_principal on atlas.household_zones for select to authenticated using (
  exists(select 1 from atlas.households h join atlas.principals p on p.id=h.principal_id where h.id=household_id and p.user_id=auth.uid())
);
create policy household_zone_items_read_principal on atlas.household_zone_items for select to authenticated using (
  exists(select 1 from atlas.household_zones z join atlas.households h on h.id=z.household_id join atlas.principals p on p.id=h.principal_id where z.id=zone_id and p.user_id=auth.uid())
);
create policy household_events_read_principal on atlas.household_events for select to authenticated using (
  exists(select 1 from atlas.households h join atlas.principals p on p.id=h.principal_id where h.id=household_id and p.user_id=auth.uid())
);
create policy owner_obligations_read_principal on atlas.owner_obligations for select to authenticated using (
  exists(select 1 from atlas.principals p where p.id=principal_id and p.user_id=auth.uid())
);
create policy operational_escalations_read_principal on atlas.operational_escalations for select to authenticated using (
  exists(select 1 from atlas.principals p where p.id=principal_id and p.user_id=auth.uid())
);
create policy principal_capacity_policies_read_principal on atlas.principal_capacity_policies for select to authenticated using (
  exists(select 1 from atlas.principals p where p.id=principal_id and p.user_id=auth.uid())
);
create policy principal_capacity_blocks_read_principal on atlas.principal_capacity_blocks for select to authenticated using (
  exists(select 1 from atlas.principals p where p.id=principal_id and p.user_id=auth.uid())
);

-- Normalized Principal capacity blockers. Household events constrain capacity directly without becoming farm tasks.
create or replace view atlas.principal_capacity_blocks_v1
with (security_invoker=true)
as
select
  b.principal_id,
  'principal_capacity_block'::text as source_type,
  b.id as source_id,
  b.title,
  b.starts_at,
  b.ends_at,
  b.block_kind,
  b.floor_class,
  b.protection_level,
  b.interruptibility,
  b.reason_for_floor,
  b.consequence,
  b.metadata
from atlas.principal_capacity_blocks b
where b.blocks_capacity
union all
select
  h.principal_id,
  'household_event'::text as source_type,
  e.id as source_id,
  e.title,
  e.starts_at,
  e.ends_at,
  e.event_kind as block_kind,
  e.floor_class,
  e.protection_level,
  e.interruptibility,
  e.reason_for_floor,
  e.consequence,
  e.metadata
from atlas.household_events e
join atlas.households h on h.id=e.household_id
where e.blocks_capacity;

-- ClockCandidate normalization only. No winner/rank is chosen here.
create or replace view atlas.principal_clock_candidates_v1
with (security_invoker=true)
as
select
  o.principal_id,
  o.domain,
  'owner_obligation'::text as source_type,
  o.id as source_id,
  o.title,
  o.floor_class,
  o.becomes_relevant_at as window_start,
  coalesce(o.expires_at,o.must_finish_by) as window_end,
  o.fixed_at as fixed_start,
  o.must_begin_by,
  o.must_finish_by,
  o.expected_minutes,
  o.protection_level,
  o.interruptibility,
  o.delegable,
  o.owner_required,
  o.consequence_of_delay as consequence,
  o.reason_for_floor,
  o.portfolio_unit_id,
  o.horizon,
  o.metadata
from atlas.owner_obligations o
where o.status in ('open','in_progress')
union all
select
  h.principal_id,
  'household'::text as domain,
  'household_event'::text as source_type,
  e.id as source_id,
  e.title,
  e.floor_class,
  e.starts_at as window_start,
  e.ends_at as window_end,
  case when e.fixed then e.starts_at else null end as fixed_start,
  null::timestamptz as must_begin_by,
  e.ends_at as must_finish_by,
  coalesce(e.expected_minutes,greatest(1,round(extract(epoch from (e.ends_at-e.starts_at))/60.0)::integer)) as expected_minutes,
  e.protection_level,
  e.interruptibility,
  false as delegable,
  e.principal_required as owner_required,
  e.consequence,
  e.reason_for_floor,
  null::uuid as portfolio_unit_id,
  null::text as horizon,
  e.metadata
from atlas.household_events e
join atlas.households h on h.id=e.household_id
where e.principal_required
union all
select
  h.principal_id,
  'household'::text as domain,
  'household_rhythm'::text as source_type,
  r.id as source_id,
  r.title,
  r.floor_class,
  r.next_window_start as window_start,
  r.next_window_end as window_end,
  null::timestamptz as fixed_start,
  r.next_window_start as must_begin_by,
  r.next_window_end as must_finish_by,
  r.expected_minutes,
  r.protection_level,
  r.interruptibility,
  false as delegable,
  r.principal_required as owner_required,
  r.consequence,
  r.reason_for_floor,
  null::uuid as portfolio_unit_id,
  null::text as horizon,
  r.metadata
from atlas.household_rhythms r
join atlas.households h on h.id=r.household_id
where r.active and r.principal_required and r.next_window_start is not null
union all
select
  e.principal_id,
  'operations'::text as domain,
  'operational_escalation'::text as source_type,
  e.id as source_id,
  e.escalation_kind as title,
  e.floor_class,
  e.window_start,
  e.window_end,
  null::timestamptz as fixed_start,
  e.window_start as must_begin_by,
  e.window_end as must_finish_by,
  e.expected_owner_minutes as expected_minutes,
  e.protection_level,
  e.interruptibility,
  false as delegable,
  true as owner_required,
  e.consequence,
  e.reason_for_floor,
  e.portfolio_unit_id,
  e.horizon,
  e.metadata || jsonb_build_object(
    'sourceSystem',e.source_system,
    'sourceType',e.source_type,
    'sourceId',e.source_id,
    'thresholdCrossed',e.threshold_crossed,
    'ownerDecisionRequired',e.owner_decision_required,
    'severity',e.severity,
    'options',e.options_json
  ) as metadata
from atlas.operational_escalations e
where e.status in ('open','acknowledged')
union all
select
  b.principal_id,
  'principal_capacity'::text as domain,
  'capacity_block'::text as source_type,
  b.id as source_id,
  b.title,
  b.floor_class,
  b.starts_at as window_start,
  b.ends_at as window_end,
  b.starts_at as fixed_start,
  b.starts_at as must_begin_by,
  b.ends_at as must_finish_by,
  greatest(1,round(extract(epoch from (b.ends_at-b.starts_at))/60.0)::integer) as expected_minutes,
  b.protection_level,
  b.interruptibility,
  false as delegable,
  true as owner_required,
  b.consequence,
  b.reason_for_floor,
  null::uuid as portfolio_unit_id,
  null::text as horizon,
  b.metadata
from atlas.principal_capacity_blocks b
where b.blocks_capacity;

create or replace function atlas.principal_capacity_day_state_v1(p_principal_id uuid,p_day date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_principal atlas.principals%rowtype;
  v_policy atlas.principal_capacity_policies%rowtype;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_elapsed integer:=0;
  v_blocked integer:=0;
  v_available integer:=0;
  v_discretionary integer:=0;
  v_maximum integer:=0;
begin
  if p_day is null then raise exception 'A Principal capacity date is required.' using errcode='22023'; end if;
  select * into v_principal from atlas.principals where id=p_principal_id;
  if v_principal.id is null then raise exception 'Principal not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and v_principal.user_id<>auth.uid() then
    raise exception 'Principal capacity may only be read by that Principal.' using errcode='42501';
  end if;
  v_timezone:=coalesce(nullif(v_principal.home_timezone,''),'America/Chicago');

  select * into v_policy
  from atlas.principal_capacity_policies p
  where p.principal_id=p_principal_id and p.active
    and p.effective_from<=p_day
    and (p.effective_through is null or p.effective_through>=p_day)
    and extract(dow from p_day)::smallint=any(p.weekdays)
  order by p.effective_from desc,p.created_at desc
  limit 1;

  if v_policy.id is null then
    return jsonb_build_object(
      'contractVersion','principal_capacity_day_state_v1',
      'principalId',p_principal_id,'serviceDate',p_day,
      'state','anchor_required','capacityKnown',false,
      'reason','No effective Principal Capacity policy defines this day.'
    );
  end if;

  v_start:=(p_day::timestamp+v_policy.local_start) at time zone v_timezone;
  v_end:=(p_day::timestamp+v_policy.local_end) at time zone v_timezone;
  v_elapsed:=greatest(0,round(extract(epoch from (v_end-v_start))/60.0)::integer);

  with spans as (
    select tstzrange(greatest(b.starts_at,v_start),least(b.ends_at,v_end),'[)') as span
    from atlas.principal_capacity_blocks_v1 b
    where b.principal_id=p_principal_id
      and b.ends_at>v_start and b.starts_at<v_end
  ), merged as (
    select range_agg(span) as spans from spans where not isempty(span)
  )
  select coalesce(sum(round(extract(epoch from (upper(r)-lower(r)))/60.0)::integer),0)
  into v_blocked
  from merged m
  cross join lateral unnest(m.spans) r;

  v_available:=greatest(v_elapsed-v_blocked,0);
  v_discretionary:=least(v_policy.default_discretionary_minutes,v_available);
  v_maximum:=least(v_policy.maximum_planned_minutes,v_available);

  return jsonb_build_object(
    'contractVersion','principal_capacity_day_state_v1',
    'principalId',p_principal_id,'serviceDate',p_day,
    'state','resolved','capacityKnown',true,'timezone',v_timezone,
    'policyId',v_policy.id,'startsAt',v_start,'endsAt',v_end,
    'elapsedMinutes',v_elapsed,'blockedMinutes',v_blocked,
    'availableElapsedMinutes',v_available,
    'discretionaryCapacityMinutes',v_discretionary,
    'maximumPlannedMinutes',v_maximum
  );
end;
$function$;

create or replace function atlas.principal_self_context_api_v1()
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_principal atlas.principals%rowtype;
  v_household jsonb;
  v_portfolio jsonb;
  v_candidates jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  select * into v_principal from atlas.principals p where p.user_id=auth.uid() and p.status='active' limit 1;
  if v_principal.id is null then
    return jsonb_build_object('contractVersion','principal_self_context_v1','state','principal_required');
  end if;

  select to_jsonb(h) into v_household from atlas.households h where h.id=v_principal.active_household_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,'stableKey',u.stable_key,'name',u.name,'unitKind',u.unit_kind,
    'linkedFarmId',u.linked_farm_id,'lifecycleState',u.lifecycle_state,
    'portfolioRole',u.portfolio_role,'horizon',u.horizon,'archivedAt',u.archived_at
  ) order by case u.horizon when 'H1' then 1 when 'H2' then 2 else 3 end,u.name),'[]'::jsonb)
  into v_portfolio
  from atlas.portfolio_units u
  where u.owner_id=v_principal.id and u.archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'domain',c.domain,'sourceType',c.source_type,'sourceId',c.source_id,'title',c.title,
    'floorClass',c.floor_class,'windowStart',c.window_start,'windowEnd',c.window_end,
    'fixedStart',c.fixed_start,'mustBeginBy',c.must_begin_by,'mustFinishBy',c.must_finish_by,
    'expectedMinutes',c.expected_minutes,'protectionLevel',c.protection_level,
    'ownerRequired',c.owner_required,'consequence',c.consequence,'reasonForFloor',c.reason_for_floor,
    'portfolioUnitId',c.portfolio_unit_id,'horizon',c.horizon
  ) order by c.floor_class,c.window_end nulls last,c.title),'[]'::jsonb)
  into v_candidates
  from atlas.principal_clock_candidates_v1 c
  where c.principal_id=v_principal.id;

  return jsonb_build_object(
    'contractVersion','principal_self_context_v1','state','ready',
    'principal',jsonb_build_object(
      'id',v_principal.id,'stableKey',v_principal.stable_key,'name',v_principal.name,
      'organizationId',v_principal.organization_id,'homeTimezone',v_principal.home_timezone,
      'activeHouseholdId',v_principal.active_household_id
    ),
    'household',v_household,
    'portfolioUnits',v_portfolio,
    'clockCandidates',v_candidates,
    'capacityToday',atlas.principal_capacity_day_state_v1(v_principal.id,(now() at time zone v_principal.home_timezone)::date)
  );
end;
$function$;

-- App roles: read-only foundation. Mutations remain service/RPC controlled until authoring contracts are added.
revoke all on atlas.principals,atlas.portfolio_units,atlas.households,atlas.household_members,atlas.household_rhythms,atlas.household_zones,atlas.household_zone_items,atlas.household_events,atlas.owner_obligations,atlas.operational_escalations,atlas.principal_capacity_policies,atlas.principal_capacity_blocks from anon,authenticated;
grant select on atlas.principals,atlas.portfolio_units,atlas.households,atlas.household_members,atlas.household_rhythms,atlas.household_zones,atlas.household_zone_items,atlas.household_events,atlas.owner_obligations,atlas.operational_escalations,atlas.principal_capacity_policies,atlas.principal_capacity_blocks to authenticated;
grant all on atlas.principals,atlas.portfolio_units,atlas.households,atlas.household_members,atlas.household_rhythms,atlas.household_zones,atlas.household_zone_items,atlas.household_events,atlas.owner_obligations,atlas.operational_escalations,atlas.principal_capacity_policies,atlas.principal_capacity_blocks to service_role;
revoke all on atlas.principal_capacity_blocks_v1,atlas.principal_clock_candidates_v1 from anon;
grant select on atlas.principal_capacity_blocks_v1,atlas.principal_clock_candidates_v1 to authenticated,service_role;
revoke all on function atlas.principal_capacity_day_state_v1(uuid,date) from public;
revoke all on function atlas.principal_self_context_api_v1() from public;
grant execute on function atlas.principal_capacity_day_state_v1(uuid,date) to authenticated,service_role;
grant execute on function atlas.principal_self_context_api_v1() to authenticated,service_role;