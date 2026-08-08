create table if not exists atlas.sky_state_samples (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  service_date date not null,
  sampled_at timestamptz not null,
  timezone_name text not null,
  frame text not null default 'geocentric',
  zodiac_basis text not null default 'tropical_true_ecliptic_of_date',
  moon_longitude_deg numeric(9,6) not null check (moon_longitude_deg >= 0 and moon_longitude_deg < 360),
  sun_longitude_deg numeric(9,6) not null check (sun_longitude_deg >= 0 and sun_longitude_deg < 360),
  moon_sign text not null,
  moon_sign_mode text not null check (moon_sign_mode in ('moveable','fixed','common')),
  phase_angle_deg numeric(9,6) not null check (phase_angle_deg >= 0 and phase_angle_deg < 360),
  illumination_fraction numeric(9,8) not null check (illumination_fraction >= 0 and illumination_fraction <= 1),
  phase_state text not null check (phase_state in ('waxing','waning')),
  source_provider text not null,
  source_version text not null,
  calculation_version text not null,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique (farm_id, service_date, calculation_version)
);

create index if not exists sky_state_samples_farm_date_idx
  on atlas.sky_state_samples (farm_id, service_date);

create table if not exists atlas.sky_windows (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  window_kind text not null,
  value_key text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone_name text not null,
  frame text not null default 'geocentric',
  zodiac_basis text,
  source_provider text not null,
  source_version text not null,
  calculation_version text not null,
  value_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (farm_id, window_kind, starts_at, calculation_version)
);

create index if not exists sky_windows_lookup_idx
  on atlas.sky_windows (farm_id, window_kind, starts_at, ends_at);
create index if not exists sky_windows_value_idx
  on atlas.sky_windows (farm_id, window_kind, value_key, starts_at);

create table if not exists atlas.sky_operation_rules (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  stable_key text not null,
  operation_class text not null references atlas.operation_classes(stable_key),
  rule_version integer not null default 1 check (rule_version > 0),
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  enforcement_mode text not null default 'informative' check (enforcement_mode in ('informative','preferred','windowed')),
  predicate jsonb not null default '{}'::jsonb,
  fitness_when_match text not null default 'favored' check (fitness_when_match in ('favored','neutral','unfavored','avoid')),
  fitness_when_no_match text not null default 'neutral' check (fitness_when_no_match in ('favored','neutral','unfavored','avoid')),
  evidence_class text not null default 'owner_operating_hypothesis' check (evidence_class in ('historically_attested','working_reconstruction','owner_operating_hypothesis','owner_preference')),
  source_summary text,
  source_refs jsonb not null default '[]'::jsonb,
  priority integer not null default 100,
  active boolean not null default false,
  valid_from date,
  valid_until date,
  owner_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key, rule_version),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  check (jsonb_typeof(predicate) = 'object'),
  check (jsonb_typeof(source_refs) = 'array')
);

create index if not exists sky_operation_rules_lookup_idx
  on atlas.sky_operation_rules (farm_id, operation_class, active, status, priority);

alter table atlas.sky_state_samples enable row level security;
alter table atlas.sky_windows enable row level security;
alter table atlas.sky_operation_rules enable row level security;

revoke all on atlas.sky_state_samples from public, anon;
revoke all on atlas.sky_windows from public, anon;
revoke all on atlas.sky_operation_rules from public, anon;

grant select on atlas.sky_state_samples to authenticated;
grant select on atlas.sky_windows to authenticated;
grant select, insert, update on atlas.sky_operation_rules to authenticated;

create policy sky_state_samples_member_read_v1
on atlas.sky_state_samples for select to authenticated
using (atlas.is_farm_member(farm_id));

create policy sky_windows_member_read_v1
on atlas.sky_windows for select to authenticated
using (atlas.is_farm_member(farm_id));

create policy sky_operation_rules_member_read_v1
on atlas.sky_operation_rules for select to authenticated
using (atlas.is_farm_member(farm_id));

create policy sky_operation_rules_owner_insert_v1
on atlas.sky_operation_rules for insert to authenticated
with check (atlas.is_farm_owner(farm_id));

create policy sky_operation_rules_owner_update_v1
on atlas.sky_operation_rules for update to authenticated
using (atlas.is_farm_owner(farm_id))
with check (atlas.is_farm_owner(farm_id));

create or replace function atlas.sky_rule_matches_v1(p_predicate jsonb, p_state jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, atlas
as $function$
declare
  v_pred jsonb := coalesce(p_predicate, '{}'::jsonb);
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_n numeric;
begin
  if v_pred ? 'moon_sign_in' then
    if jsonb_typeof(v_pred->'moon_sign_in') <> 'array'
       or not ((v_pred->'moon_sign_in') ? coalesce(v_state->>'moonSign','')) then
      return false;
    end if;
  end if;

  if v_pred ? 'moon_mode_in' then
    if jsonb_typeof(v_pred->'moon_mode_in') <> 'array'
       or not ((v_pred->'moon_mode_in') ? coalesce(v_state->>'moonMode','')) then
      return false;
    end if;
  end if;

  if v_pred ? 'phase_state_in' then
    if jsonb_typeof(v_pred->'phase_state_in') <> 'array'
       or not ((v_pred->'phase_state_in') ? coalesce(v_state->>'phaseState','')) then
      return false;
    end if;
  end if;

  if v_pred ? 'illumination_min' then
    begin v_n := (v_state->>'illuminationFraction')::numeric; exception when others then return false; end;
    if v_n < (v_pred->>'illumination_min')::numeric then return false; end if;
  end if;

  if v_pred ? 'illumination_max' then
    begin v_n := (v_state->>'illuminationFraction')::numeric; exception when others then return false; end;
    if v_n > (v_pred->>'illumination_max')::numeric then return false; end if;
  end if;

  return true;
end;
$function$;

create or replace function atlas.sky_state_at_v1(p_farm_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_at timestamptz := coalesce(p_at, now());
  v_sign atlas.sky_windows%rowtype;
  v_mode atlas.sky_windows%rowtype;
  v_phase atlas.sky_windows%rowtype;
  v_sample atlas.sky_state_samples%rowtype;
begin
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_sign from atlas.sky_windows w
  where w.farm_id=p_farm_id and w.window_kind='moon_sign'
    and w.starts_at <= v_at and v_at < w.ends_at
  order by w.starts_at desc limit 1;

  select * into v_mode from atlas.sky_windows w
  where w.farm_id=p_farm_id and w.window_kind='moon_mode'
    and w.starts_at <= v_at and v_at < w.ends_at
  order by w.starts_at desc limit 1;

  select * into v_phase from atlas.sky_windows w
  where w.farm_id=p_farm_id and w.window_kind='moon_phase_half'
    and w.starts_at <= v_at and v_at < w.ends_at
  order by w.starts_at desc limit 1;

  select * into v_sample from atlas.sky_state_samples s
  where s.farm_id=p_farm_id
  order by abs(extract(epoch from (s.sampled_at-v_at))) asc
  limit 1;

  return jsonb_build_object(
    'contractVersion','sky_state_at_v1',
    'farmId',p_farm_id,
    'at',v_at,
    'moonSign',v_sign.value_key,
    'moonSignWindowStart',v_sign.starts_at,
    'moonSignWindowEnd',v_sign.ends_at,
    'moonMode',v_mode.value_key,
    'moonModeWindowStart',v_mode.starts_at,
    'moonModeWindowEnd',v_mode.ends_at,
    'phaseState',coalesce(v_phase.value_key,v_sample.phase_state),
    'phaseWindowStart',v_phase.starts_at,
    'phaseWindowEnd',v_phase.ends_at,
    'moonLongitudeDeg',v_sample.moon_longitude_deg,
    'sunLongitudeDeg',v_sample.sun_longitude_deg,
    'phaseAngleDeg',v_sample.phase_angle_deg,
    'illuminationFraction',v_sample.illumination_fraction,
    'sampledAt',v_sample.sampled_at,
    'sourceProvider',coalesce(v_sign.source_provider,v_sample.source_provider),
    'sourceVersion',coalesce(v_sign.source_version,v_sample.source_version),
    'calculationVersion',coalesce(v_sign.calculation_version,v_sample.calculation_version)
  );
end;
$function$;

create or replace function atlas.task_sky_fitness_v1(p_task_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_rule atlas.sky_operation_rules%rowtype;
  v_state jsonb;
  v_matches boolean;
  v_fitness text;
  v_eligible boolean := true;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_task.farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  v_state := atlas.sky_state_at_v1(v_task.farm_id,coalesce(p_at,now()));

  select * into v_rule
  from atlas.sky_operation_rules r
  where r.farm_id=v_task.farm_id
    and r.operation_class=v_task.operation_class
    and r.active
    and r.status='approved'
    and (r.valid_from is null or r.valid_from <= (coalesce(p_at,now()) at time zone coalesce(v_task.metadata->>'timezone','America/Chicago'))::date)
    and (r.valid_until is null or r.valid_until >= (coalesce(p_at,now()) at time zone coalesce(v_task.metadata->>'timezone','America/Chicago'))::date)
    and (v_task.metadata->>'sky_rule_key_manual' is null or r.stable_key=v_task.metadata->>'sky_rule_key_manual')
  order by r.priority asc, r.rule_version desc, r.created_at desc
  limit 1;

  if v_task.operation_class is null then
    return jsonb_build_object('contractVersion','task_sky_fitness_v1','taskId',v_task.id,'operationClass',null,'fitness','unclassified','enforcementMode','informative','eligibleUnderSky',true,'state',v_state);
  end if;

  if coalesce(v_task.metadata->>'sky_timing_mode','')='ignore' then
    return jsonb_build_object('contractVersion','task_sky_fitness_v1','taskId',v_task.id,'operationClass',v_task.operation_class,'fitness','owner_override','enforcementMode','informative','eligibleUnderSky',true,'overrideReason','task_sky_timing_mode_ignore','state',v_state);
  end if;

  if v_rule.id is null then
    return jsonb_build_object('contractVersion','task_sky_fitness_v1','taskId',v_task.id,'operationClass',v_task.operation_class,'fitness','unruled','enforcementMode','informative','eligibleUnderSky',true,'state',v_state);
  end if;

  v_matches := atlas.sky_rule_matches_v1(v_rule.predicate,v_state);
  v_fitness := case when v_matches then v_rule.fitness_when_match else v_rule.fitness_when_no_match end;
  v_eligible := not (v_rule.enforcement_mode='windowed' and v_fitness in ('unfavored','avoid','neutral'));

  return jsonb_build_object(
    'contractVersion','task_sky_fitness_v1',
    'taskId',v_task.id,
    'operationClass',v_task.operation_class,
    'fitness',v_fitness,
    'ruleMatched',v_matches,
    'enforcementMode',v_rule.enforcement_mode,
    'eligibleUnderSky',v_eligible,
    'rule',jsonb_build_object(
      'id',v_rule.id,'stableKey',v_rule.stable_key,'version',v_rule.rule_version,
      'evidenceClass',v_rule.evidence_class,'sourceSummary',v_rule.source_summary
    ),
    'state',v_state
  );
end;
$function$;

revoke all on function atlas.sky_rule_matches_v1(jsonb,jsonb) from public;
revoke all on function atlas.sky_state_at_v1(uuid,timestamptz) from public;
revoke all on function atlas.task_sky_fitness_v1(uuid,timestamptz) from public;
grant execute on function atlas.sky_state_at_v1(uuid,timestamptz) to authenticated;
grant execute on function atlas.task_sky_fitness_v1(uuid,timestamptz) to authenticated;

comment on table atlas.sky_state_samples is 'Farm-local daily sky facts sampled at the configured local-noon basis. Facts only; no work interpretation.';
comment on table atlas.sky_windows is 'Continuous calculated celestial-state windows. Facts only; no operation preference encoded here.';
comment on table atlas.sky_operation_rules is 'Owner-approved bridge from canonical Atlas operation classes to sky-state predicates, with evidence and enforcement provenance.';
