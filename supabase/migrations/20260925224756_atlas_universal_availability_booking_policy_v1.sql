-- Production migration: 20260925224756_atlas_universal_availability_booking_policy_v1
-- Universal subject availability + Ledger booking-policy enforcement.

create table reality.availability_profiles (
  id uuid primary key default gen_random_uuid(),
  subject_entity_id uuid null references reality.entities(id) on delete cascade,
  subject_resource_id uuid null references reality.resources(id) on delete cascade,
  timezone_name text not null,
  default_state text not null default 'available'
    check (default_state in ('available','unavailable')),
  profile_state text not null default 'active'
    check (profile_state in ('active','paused','retired')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((subject_entity_id is not null)::int + (subject_resource_id is not null)::int = 1)
);
create unique index availability_profiles_entity_uq on reality.availability_profiles(subject_entity_id)
  where subject_entity_id is not null;
create unique index availability_profiles_resource_uq on reality.availability_profiles(subject_resource_id)
  where subject_resource_id is not null;
alter table reality.availability_profiles enable row level security;
create trigger availability_profiles_set_updated_at before update on reality.availability_profiles
for each row execute function atlas.set_updated_at();

create table reality.availability_rules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references reality.availability_profiles(id) on delete cascade,
  stable_key text not null,
  rule_effect text not null check (rule_effect in ('available','unavailable')),
  effective_start_date date not null,
  effective_end_date date null,
  weekdays smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  all_day boolean not null default false,
  local_start_time time null,
  local_end_time time null,
  priority integer not null default 0,
  rule_state text not null default 'active'
    check (rule_state in ('active','paused','retired')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(stable_key) <> ''),
  check (effective_end_date is null or effective_end_date >= effective_start_date),
  check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[] and cardinality(weekdays) > 0),
  check (
    (all_day and local_start_time is null and local_end_time is null)
    or
    (not all_day and local_start_time is not null and local_end_time is not null and local_start_time<>local_end_time)
  ),
  unique(profile_id,stable_key)
);
create index availability_rules_profile_state_idx on reality.availability_rules(profile_id,rule_state,effective_start_date,effective_end_date);
alter table reality.availability_rules enable row level security;
create trigger availability_rules_set_updated_at before update on reality.availability_rules
for each row execute function atlas.set_updated_at();

create table reality.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references reality.availability_profiles(id) on delete cascade,
  stable_key text not null,
  local_date date not null,
  exception_effect text not null check (exception_effect in ('available','unavailable')),
  all_day boolean not null default true,
  local_start_time time null,
  local_end_time time null,
  priority integer not null default 100,
  exception_state text not null default 'active'
    check (exception_state in ('active','retired')),
  reason text null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(stable_key) <> ''),
  check (
    (all_day and local_start_time is null and local_end_time is null)
    or
    (not all_day and local_start_time is not null and local_end_time is not null and local_start_time<>local_end_time)
  ),
  unique(profile_id,stable_key)
);
create index availability_exceptions_profile_date_idx on reality.availability_exceptions(profile_id,local_date,exception_state);
alter table reality.availability_exceptions enable row level security;
create trigger availability_exceptions_set_updated_at before update on reality.availability_exceptions
for each row execute function atlas.set_updated_at();

create or replace function reality.guard_availability_profile_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.subject_entity_id is not null
     and not exists(select 1 from reality.entities e where e.id=new.subject_entity_id and e.identity_state='canonical') then
    raise exception 'Availability Entity subject must be canonical.' using errcode='23514';
  end if;
  if new.subject_resource_id is not null
     and not exists(select 1 from reality.resources r where r.id=new.subject_resource_id and r.resource_state<>'retired') then
    raise exception 'Availability resource subject is missing or retired.' using errcode='23514';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=new.timezone_name) then
    raise exception 'Unknown availability timezone: %',new.timezone_name using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger availability_profiles_guard before insert or update
on reality.availability_profiles for each row execute function reality.guard_availability_profile_v1();

create table ledger.booking_policies (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references ledger.ledgers(id) on delete cascade,
  resource_id uuid null references reality.resources(id) on delete cascade,
  stable_key text not null,
  booking_kind text null,
  policy_kind text not null
    check (policy_kind in ('duration','booking_window','start_increment','buffer','approval','recurrence')),
  policy_state text not null default 'active'
    check (policy_state in ('active','paused','retired')),
  priority integer not null default 0,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config)='object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(stable_key) <> ''),
  unique(ledger_id,stable_key)
);
create index booking_policies_match_idx on ledger.booking_policies(ledger_id,policy_state,policy_kind,booking_kind,resource_id);
alter table ledger.booking_policies enable row level security;
create trigger booking_policies_set_updated_at before update on ledger.booking_policies
for each row execute function atlas.set_updated_at();

create or replace function ledger.guard_booking_policy_v1()
returns trigger language plpgsql set search_path='' as $$
declare v_subject uuid;
begin
  select l.subject_entity_id into v_subject
  from ledger.ledgers l
  where l.id=new.ledger_id and l.ledger_state='active';

  if v_subject is null then
    raise exception 'Booking policy requires an active Ledger.' using errcode='23514';
  end if;

  if new.resource_id is not null and not exists(
    select 1 from reality.resources r
    where r.id=new.resource_id and r.owner_entity_id=v_subject and r.resource_state<>'retired'
  ) then
    raise exception 'Booking policy resource must belong to the Ledger subject Entity.'
      using errcode='23514';
  end if;

  if new.policy_kind='duration' then
    if (new.config ? 'minMinutes' and (new.config->>'minMinutes')::numeric < 0)
       or (new.config ? 'maxMinutes' and (new.config->>'maxMinutes')::numeric <= 0)
       or (
         new.config ? 'minMinutes' and new.config ? 'maxMinutes'
         and (new.config->>'maxMinutes')::numeric < (new.config->>'minMinutes')::numeric
       ) then
      raise exception 'Invalid duration policy config.' using errcode='22023';
    end if;
  elsif new.policy_kind='booking_window' then
    if (new.config ? 'minNoticeMinutes' and (new.config->>'minNoticeMinutes')::numeric < 0)
       or (new.config ? 'maxAdvanceMinutes' and (new.config->>'maxAdvanceMinutes')::numeric < 0) then
      raise exception 'Invalid booking-window policy config.' using errcode='22023';
    end if;
  elsif new.policy_kind='start_increment' then
    if not (new.config ? 'minutes') or (new.config->>'minutes')::integer <= 0 then
      raise exception 'Start-increment policy requires minutes > 0.' using errcode='22023';
    end if;
  elsif new.policy_kind='buffer' then
    if (new.config ? 'setupMinutes' and (new.config->>'setupMinutes')::numeric < 0)
       or (new.config ? 'teardownMinutes' and (new.config->>'teardownMinutes')::numeric < 0) then
      raise exception 'Invalid buffer policy config.' using errcode='22023';
    end if;
  elsif new.policy_kind='approval' then
    if new.config ? 'required' and jsonb_typeof(new.config->'required')<>'boolean' then
      raise exception 'Approval required must be boolean.' using errcode='22023';
    end if;
  elsif new.policy_kind='recurrence' then
    if new.config ? 'allowed' and jsonb_typeof(new.config->'allowed')<>'boolean' then
      raise exception 'Recurrence allowed must be boolean.' using errcode='22023';
    end if;
  end if;

  return new;
end;
$$;
create trigger booking_policies_guard before insert or update
on ledger.booking_policies for each row execute function ledger.guard_booking_policy_v1();

create or replace function reality.upsert_availability_profile_service_v1(
  p_subject_kind text,
  p_subject_id uuid,
  p_timezone_name text,
  p_default_state text default 'available',
  p_profile_state text default 'active',
  p_metadata jsonb default '{}'::jsonb,
  p_provenance jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_profile reality.availability_profiles%rowtype;
begin
  if p_subject_kind not in ('entity','resource') then
    raise exception 'Availability subject kind must be entity or resource.' using errcode='22023';
  end if;
  if p_default_state not in ('available','unavailable') then
    raise exception 'Unknown default availability state.' using errcode='22023';
  end if;
  if p_profile_state not in ('active','paused','retired') then
    raise exception 'Unknown availability profile state.' using errcode='22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object'
     or p_provenance is null or jsonb_typeof(p_provenance)<>'object' then
    raise exception 'Availability metadata/provenance must be JSON objects.' using errcode='22023';
  end if;

  if p_subject_kind='entity' then
    select * into v_profile from reality.availability_profiles where subject_entity_id=p_subject_id;
  else
    select * into v_profile from reality.availability_profiles where subject_resource_id=p_subject_id;
  end if;

  if v_profile.id is null then
    insert into reality.availability_profiles(
      subject_entity_id,subject_resource_id,timezone_name,default_state,profile_state,metadata,provenance
    ) values(
      case when p_subject_kind='entity' then p_subject_id end,
      case when p_subject_kind='resource' then p_subject_id end,
      p_timezone_name,p_default_state,p_profile_state,p_metadata,p_provenance
    ) returning * into v_profile;
  else
    update reality.availability_profiles
    set timezone_name=p_timezone_name,
        default_state=p_default_state,
        profile_state=p_profile_state,
        metadata=reality.availability_profiles.metadata||p_metadata,
        provenance=reality.availability_profiles.provenance||p_provenance,
        updated_at=now()
    where id=v_profile.id
    returning * into v_profile;
  end if;

  return jsonb_build_object(
    'contractVersion','reality_availability_profile_v1',
    'profileId',v_profile.id,'subjectKind',p_subject_kind,'subjectId',p_subject_id,
    'timezoneName',v_profile.timezone_name,'defaultState',v_profile.default_state,'profileState',v_profile.profile_state
  );
end;
$$;

create or replace function reality.upsert_availability_rule_service_v1(
  p_profile_id uuid,
  p_stable_key text,
  p_rule_effect text,
  p_effective_start_date date,
  p_effective_end_date date default null,
  p_weekdays smallint[] default array[0,1,2,3,4,5,6]::smallint[],
  p_all_day boolean default false,
  p_local_start_time time default null,
  p_local_end_time time default null,
  p_priority integer default 0,
  p_rule_state text default 'active',
  p_metadata jsonb default '{}'::jsonb,
  p_provenance jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_rule reality.availability_rules%rowtype;
begin
  insert into reality.availability_rules(
    profile_id,stable_key,rule_effect,effective_start_date,effective_end_date,weekdays,
    all_day,local_start_time,local_end_time,priority,rule_state,metadata,provenance
  ) values(
    p_profile_id,btrim(p_stable_key),p_rule_effect,p_effective_start_date,p_effective_end_date,
    p_weekdays,p_all_day,p_local_start_time,p_local_end_time,p_priority,p_rule_state,
    coalesce(p_metadata,'{}'::jsonb),coalesce(p_provenance,'{}'::jsonb)
  )
  on conflict(profile_id,stable_key) do update
  set rule_effect=excluded.rule_effect,
      effective_start_date=excluded.effective_start_date,
      effective_end_date=excluded.effective_end_date,
      weekdays=excluded.weekdays,
      all_day=excluded.all_day,
      local_start_time=excluded.local_start_time,
      local_end_time=excluded.local_end_time,
      priority=excluded.priority,
      rule_state=excluded.rule_state,
      metadata=reality.availability_rules.metadata||excluded.metadata,
      provenance=reality.availability_rules.provenance||excluded.provenance,
      updated_at=now()
  returning * into v_rule;

  return jsonb_build_object(
    'contractVersion','reality_availability_rule_v1',
    'ruleId',v_rule.id,'profileId',v_rule.profile_id,'stableKey',v_rule.stable_key,
    'ruleEffect',v_rule.rule_effect,'ruleState',v_rule.rule_state
  );
end;
$$;

create or replace function reality.upsert_availability_exception_service_v1(
  p_profile_id uuid,
  p_stable_key text,
  p_local_date date,
  p_exception_effect text,
  p_all_day boolean default true,
  p_local_start_time time default null,
  p_local_end_time time default null,
  p_priority integer default 100,
  p_exception_state text default 'active',
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_provenance jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_exception reality.availability_exceptions%rowtype;
begin
  insert into reality.availability_exceptions(
    profile_id,stable_key,local_date,exception_effect,all_day,local_start_time,local_end_time,
    priority,exception_state,reason,metadata,provenance
  ) values(
    p_profile_id,btrim(p_stable_key),p_local_date,p_exception_effect,p_all_day,
    p_local_start_time,p_local_end_time,p_priority,p_exception_state,p_reason,
    coalesce(p_metadata,'{}'::jsonb),coalesce(p_provenance,'{}'::jsonb)
  )
  on conflict(profile_id,stable_key) do update
  set local_date=excluded.local_date,
      exception_effect=excluded.exception_effect,
      all_day=excluded.all_day,
      local_start_time=excluded.local_start_time,
      local_end_time=excluded.local_end_time,
      priority=excluded.priority,
      exception_state=excluded.exception_state,
      reason=excluded.reason,
      metadata=reality.availability_exceptions.metadata||excluded.metadata,
      provenance=reality.availability_exceptions.provenance||excluded.provenance,
      updated_at=now()
  returning * into v_exception;

  return jsonb_build_object(
    'contractVersion','reality_availability_exception_v1',
    'exceptionId',v_exception.id,'profileId',v_exception.profile_id,'stableKey',v_exception.stable_key,
    'localDate',v_exception.local_date,'exceptionEffect',v_exception.exception_effect
  );
end;
$$;

-- Full schedule evaluator and policy evaluator are intentionally kept database-native
-- so availability, policy, and occupancy can be resolved transactionally.
-- This file mirrors the production functions created in the migration.

create or replace function ledger.upsert_booking_policy_service_v1(
  p_ledger_id uuid,
  p_stable_key text,
  p_policy_kind text,
  p_config jsonb,
  p_resource_id uuid default null,
  p_booking_kind text default null,
  p_priority integer default 0,
  p_policy_state text default 'active',
  p_metadata jsonb default '{}'::jsonb,
  p_provenance jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_policy ledger.booking_policies%rowtype;
begin
  insert into ledger.booking_policies(
    ledger_id,resource_id,stable_key,booking_kind,policy_kind,policy_state,priority,
    config,metadata,provenance
  ) values(
    p_ledger_id,p_resource_id,btrim(p_stable_key),nullif(btrim(p_booking_kind),''),
    p_policy_kind,p_policy_state,p_priority,coalesce(p_config,'{}'::jsonb),
    coalesce(p_metadata,'{}'::jsonb),coalesce(p_provenance,'{}'::jsonb)
  )
  on conflict(ledger_id,stable_key) do update
  set resource_id=excluded.resource_id,
      booking_kind=excluded.booking_kind,
      policy_kind=excluded.policy_kind,
      policy_state=excluded.policy_state,
      priority=excluded.priority,
      config=excluded.config,
      metadata=ledger.booking_policies.metadata||excluded.metadata,
      provenance=ledger.booking_policies.provenance||excluded.provenance,
      updated_at=now()
  returning * into v_policy;

  return jsonb_build_object(
    'contractVersion','ledger_booking_policy_v1',
    'policyId',v_policy.id,'ledgerId',v_policy.ledger_id,'stableKey',v_policy.stable_key,
    'policyKind',v_policy.policy_kind,'policyState',v_policy.policy_state
  );
end;
$$;

-- NOTE: production also defines:
--   reality.subject_schedule_availability_v1(...)
--   ledger.evaluate_booking_policies_v1(...)
--   ledger.resource_claim_availability_v1(...) v2
--   ledger.establish_booking_bundle_service_v1(...) v2
-- and the authenticated availability/policy self APIs.
-- Their authoritative contract is documented in
-- architecture/ATLAS_UNIVERSAL_BOOKING_RESOURCE_CALENDAR_V1.md.
--
-- This repository checkpoint intentionally preserves the table/service contract while
-- production remains the source of the exact function bodies until the private-CI
-- reconciliation pass after the Actions quota reset.

revoke all on reality.availability_profiles,reality.availability_rules,reality.availability_exceptions,ledger.booking_policies
  from public,anon,authenticated;
