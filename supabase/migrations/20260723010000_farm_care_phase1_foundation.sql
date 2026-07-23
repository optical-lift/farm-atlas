-- Atlas Farm Care — Phase 1 canonical object care state
-- Controlling product direction: object state is truth; tasks are downstream outputs.
-- This migration extends atlas.object_state instead of creating a competing object registry.

alter table atlas.object_state
  add column if not exists care_state text not null default 'unknown',
  add column if not exists care_strategy text not null default 'unknown',
  add column if not exists care_pressure text not null default 'unknown',
  add column if not exists care_trend text not null default 'unknown',
  add column if not exists care_freshness text not null default 'unknown',
  add column if not exists care_observed_at timestamptz,
  add column if not exists care_review_on date,
  add column if not exists care_estimated_recovery_minutes integer,
  add column if not exists care_source_kind text not null default 'unknown',
  add column if not exists care_strategy_source text,
  add column if not exists care_strategy_set_at timestamptz,
  add column if not exists care_strategy_set_by_membership_id uuid,
  add column if not exists care_reason jsonb not null default '{}'::jsonb,
  add column if not exists care_updated_at timestamptz not null default now();

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.object_state'::regclass
      and conname='object_state_care_state_check'
  ) then
    alter table atlas.object_state
      add constraint object_state_care_state_check
      check (care_state in (
        'settled','stirring','needs_tending','losing_shape','recovery_needed',
        'resting','suppressed','decision_needed','unknown'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.object_state'::regclass
      and conname='object_state_care_strategy_check'
  ) then
    alter table atlas.object_state
      add constraint object_state_care_strategy_check
      check (care_strategy in (
        'active_hand_care','targeted_recovery','mow_and_hold',
        'suppressed_by_tarp','mulch_hold','cover_crop_hold',
        'resting_until_review','redesign_pending','removal_pending','unknown'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.object_state'::regclass
      and conname='object_state_care_pressure_check'
  ) then
    alter table atlas.object_state
      add constraint object_state_care_pressure_check
      check (care_pressure in ('none','light','moderate','heavy','severe','unknown'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.object_state'::regclass
      and conname='object_state_care_trend_check'
  ) then
    alter table atlas.object_state
      add constraint object_state_care_trend_check
      check (care_trend in ('improving','stable','rising','unknown'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.object_state'::regclass
      and conname='object_state_care_freshness_check'
  ) then
    alter table atlas.object_state
      add constraint object_state_care_freshness_check
      check (care_freshness in ('observed','estimated','stale','unknown'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.object_state'::regclass
      and conname='object_state_care_source_kind_check'
  ) then
    alter table atlas.object_state
      add constraint object_state_care_source_kind_check
      check (care_source_kind in (
        'observation','completion','strategy','estimate','migration','unknown'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.object_state'::regclass
      and conname='object_state_care_estimated_recovery_minutes_check'
  ) then
    alter table atlas.object_state
      add constraint object_state_care_estimated_recovery_minutes_check
      check (
        care_estimated_recovery_minutes is null
        or care_estimated_recovery_minutes >= 0
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.object_state'::regclass
      and conname='object_state_care_strategy_membership_fkey'
  ) then
    alter table atlas.object_state
      add constraint object_state_care_strategy_membership_fkey
      foreign key (care_strategy_set_by_membership_id)
      references atlas.farm_memberships(id)
      on delete set null;
  end if;
end
$constraints$;

create table if not exists atlas.care_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  zone_id uuid references atlas.zones(id) on delete set null,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  observed_at timestamptz not null default now(),
  observed_by_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  source_kind text not null default 'field_observation',
  source_key text unique,
  source_task_id uuid references atlas.tasks(id) on delete set null,
  source_maintenance_history_id uuid references atlas.maintenance_history(id) on delete set null,
  pressure_band text not null default 'unknown',
  intended_shape_readable boolean,
  function_protected boolean,
  recovery_required boolean,
  estimated_recovery_minutes integer,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (source_kind in (
    'field_observation','owner_report','completion_result',
    'legacy_condition','controlling_spec','system'
  )),
  check (pressure_band in ('none','light','moderate','heavy','severe','unknown')),
  check (
    estimated_recovery_minutes is null
    or estimated_recovery_minutes >= 0
  )
);

create index if not exists care_observations_object_observed_idx
  on atlas.care_observations(object_id, observed_at desc);

create index if not exists care_observations_farm_observed_idx
  on atlas.care_observations(farm_id, observed_at desc);

create table if not exists atlas.care_state_history (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  zone_id uuid references atlas.zones(id) on delete set null,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  previous_state text,
  resulting_state text not null,
  previous_strategy text,
  resulting_strategy text not null,
  previous_pressure text,
  resulting_pressure text not null,
  previous_trend text,
  resulting_trend text not null,
  previous_freshness text,
  resulting_freshness text not null,
  source_kind text not null,
  source_observation_id uuid references atlas.care_observations(id) on delete set null,
  source_maintenance_history_id uuid references atlas.maintenance_history(id) on delete set null,
  source_task_id uuid references atlas.tasks(id) on delete set null,
  actor_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  reason jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  check (previous_state is null or previous_state in (
    'settled','stirring','needs_tending','losing_shape','recovery_needed',
    'resting','suppressed','decision_needed','unknown'
  )),
  check (resulting_state in (
    'settled','stirring','needs_tending','losing_shape','recovery_needed',
    'resting','suppressed','decision_needed','unknown'
  )),
  check (previous_strategy is null or previous_strategy in (
    'active_hand_care','targeted_recovery','mow_and_hold',
    'suppressed_by_tarp','mulch_hold','cover_crop_hold',
    'resting_until_review','redesign_pending','removal_pending','unknown'
  )),
  check (resulting_strategy in (
    'active_hand_care','targeted_recovery','mow_and_hold',
    'suppressed_by_tarp','mulch_hold','cover_crop_hold',
    'resting_until_review','redesign_pending','removal_pending','unknown'
  )),
  check (previous_pressure is null or previous_pressure in (
    'none','light','moderate','heavy','severe','unknown'
  )),
  check (resulting_pressure in ('none','light','moderate','heavy','severe','unknown')),
  check (previous_trend is null or previous_trend in (
    'improving','stable','rising','unknown'
  )),
  check (resulting_trend in ('improving','stable','rising','unknown')),
  check (previous_freshness is null or previous_freshness in (
    'observed','estimated','stale','unknown'
  )),
  check (resulting_freshness in ('observed','estimated','stale','unknown')),
  check (source_kind in (
    'observation','completion','strategy','estimate','migration','unknown'
  ))
);

create index if not exists care_state_history_object_occurred_idx
  on atlas.care_state_history(object_id, occurred_at desc);

create index if not exists care_state_history_farm_occurred_idx
  on atlas.care_state_history(farm_id, occurred_at desc);

alter table atlas.care_observations enable row level security;
alter table atlas.care_state_history enable row level security;

drop policy if exists care_observations_read_operations
  on atlas.care_observations;
create policy care_observations_read_operations
  on atlas.care_observations
  for select
  to authenticated
  using (atlas.can_read_farm_operations(farm_id));

drop policy if exists care_state_history_read_operations
  on atlas.care_state_history;
create policy care_state_history_read_operations
  on atlas.care_state_history
  for select
  to authenticated
  using (atlas.can_read_farm_operations(farm_id));

grant select on atlas.care_observations to authenticated;
grant select on atlas.care_state_history to authenticated;
revoke insert, update, delete on atlas.care_observations from authenticated;
revoke insert, update, delete on atlas.care_state_history from authenticated;

create or replace function atlas.care_pressure_rank_v1(p_pressure text)
returns integer
language sql
immutable
set search_path to pg_catalog, atlas
as $function$
  select case p_pressure
    when 'none' then 0
    when 'light' then 1
    when 'moderate' then 2
    when 'heavy' then 3
    when 'severe' then 4
    else null
  end
$function$;

create or replace function atlas.care_strategy_allows_ordinary_weeding_v1(
  p_object_id uuid,
  p_as_of date default current_date
)
returns boolean
language plpgsql
stable
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_strategy text;
  v_review_on date;
begin
  select care_strategy, care_review_on
  into v_strategy, v_review_on
  from atlas.object_state
  where object_id=p_object_id;

  -- Unknown remains permissive during the Phase 1 transition so this migration
  -- does not silently retire the legacy queue before the intervention-engine
  -- cutover. Explicit hold/suppression/decision strategies are enforced now.
  if not found or v_strategy='unknown' then
    return true;
  end if;

  if v_strategy in (
    'mow_and_hold','suppressed_by_tarp','mulch_hold','cover_crop_hold',
    'resting_until_review','redesign_pending','removal_pending'
  ) then
    return false;
  end if;

  return true;
end
$function$;

create or replace function atlas.refresh_object_care_state_v1(
  p_object_id uuid,
  p_as_of date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_as_of date := coalesce(p_as_of,current_date);
  v_object atlas.growing_objects%rowtype;
  v_old atlas.object_state%rowtype;
  v_observation atlas.care_observations%rowtype;
  v_previous_observation atlas.care_observations%rowtype;
  v_history atlas.maintenance_history%rowtype;
  v_has_observation boolean := false;
  v_has_previous_observation boolean := false;
  v_has_history boolean := false;
  v_observation_age integer;
  v_history_age integer;
  v_state text := 'unknown';
  v_pressure text := 'unknown';
  v_trend text := 'unknown';
  v_freshness text := 'unknown';
  v_source_kind text := 'unknown';
  v_observed_at timestamptz;
  v_estimated_minutes integer;
  v_reason jsonb := '{}'::jsonb;
  v_actor_membership_id uuid;
begin
  select *
  into v_object
  from atlas.growing_objects
  where id=p_object_id;

  if not found then
    raise exception 'Growing object % was not found.',p_object_id
      using errcode='P0002';
  end if;

  insert into atlas.object_state(object_id,farm_id)
  values(v_object.id,v_object.farm_id)
  on conflict(object_id) do nothing;

  select *
  into v_old
  from atlas.object_state
  where object_id=v_object.id
  for update;

  select *
  into v_observation
  from atlas.care_observations
  where object_id=v_object.id
    and observed_at::date<=v_as_of
  order by observed_at desc,id desc
  limit 1;
  v_has_observation := found;

  if v_has_observation then
    select *
    into v_previous_observation
    from atlas.care_observations
    where object_id=v_object.id
      and observed_at<v_observation.observed_at
    order by observed_at desc,id desc
    limit 1;
    v_has_previous_observation := found;
  end if;

  select *
  into v_history
  from atlas.maintenance_history
  where object_id=v_object.id
    and completed_at::date<=v_as_of
  order by completed_at desc,id desc
  limit 1;
  v_has_history := found;

  if v_old.care_strategy='resting_until_review' then
    if v_old.care_review_on is not null and v_old.care_review_on<=v_as_of then
      v_state := 'decision_needed';
      v_reason := jsonb_build_object(
        'basis','strategy_review_due',
        'review_on',v_old.care_review_on
      );
    else
      v_state := 'resting';
      v_reason := jsonb_strip_nulls(jsonb_build_object(
        'basis','resting_strategy',
        'review_on',v_old.care_review_on
      ));
    end if;
    v_freshness := 'estimated';
    v_source_kind := 'strategy';
    v_observed_at := v_old.care_strategy_set_at;

  elsif v_old.care_strategy in (
    'mow_and_hold','suppressed_by_tarp','mulch_hold','cover_crop_hold'
  ) then
    v_state := 'suppressed';
    v_freshness := 'estimated';
    v_source_kind := 'strategy';
    v_observed_at := v_old.care_strategy_set_at;
    v_reason := jsonb_build_object(
      'basis','suppression_strategy',
      'strategy',v_old.care_strategy
    );

  elsif v_old.care_strategy in ('redesign_pending','removal_pending') then
    v_state := 'decision_needed';
    v_freshness := 'estimated';
    v_source_kind := 'strategy';
    v_observed_at := v_old.care_strategy_set_at;
    v_reason := jsonb_build_object(
      'basis','management_decision_strategy',
      'strategy',v_old.care_strategy
    );

  elsif v_has_observation then
    v_observation_age := greatest(0,v_as_of-v_observation.observed_at::date);
    v_observed_at := v_observation.observed_at;
    v_estimated_minutes := v_observation.estimated_recovery_minutes;
    v_source_kind := 'observation';

    if v_observation_age>21 then
      v_state := 'unknown';
      v_pressure := 'unknown';
      v_trend := 'unknown';
      v_freshness := 'stale';
      v_reason := jsonb_build_object(
        'basis','stale_observation',
        'observation_id',v_observation.id,
        'observation_age_days',v_observation_age
      );
    else
      v_pressure := v_observation.pressure_band;
      v_freshness := case
        when v_observation_age<=7 then 'observed'
        else 'estimated'
      end;

      v_state := case
        when coalesce(v_observation.recovery_required,false)
          or v_observation.pressure_band='severe'
          then 'recovery_needed'
        when v_observation.intended_shape_readable is false
          or v_observation.function_protected is false
          or v_observation.pressure_band='heavy'
          then 'losing_shape'
        when v_observation.pressure_band='moderate'
          then 'needs_tending'
        when v_observation.pressure_band='light'
          then 'stirring'
        when v_observation.pressure_band='none'
          and coalesce(v_observation.intended_shape_readable,true)
          and coalesce(v_observation.function_protected,true)
          then 'settled'
        else 'unknown'
      end;

      if v_has_previous_observation
        and atlas.care_pressure_rank_v1(v_previous_observation.pressure_band) is not null
        and atlas.care_pressure_rank_v1(v_observation.pressure_band) is not null
      then
        v_trend := case
          when atlas.care_pressure_rank_v1(v_observation.pressure_band)
             < atlas.care_pressure_rank_v1(v_previous_observation.pressure_band)
            then 'improving'
          when atlas.care_pressure_rank_v1(v_observation.pressure_band)
             > atlas.care_pressure_rank_v1(v_previous_observation.pressure_band)
            then 'rising'
          else 'stable'
        end;
      else
        v_trend := 'unknown';
      end if;

      v_reason := jsonb_strip_nulls(jsonb_build_object(
        'basis','recent_observation',
        'observation_id',v_observation.id,
        'observation_age_days',v_observation_age,
        'shape_readable',v_observation.intended_shape_readable,
        'function_protected',v_observation.function_protected,
        'recovery_required',v_observation.recovery_required
      ));
    end if;

  elsif v_has_history then
    v_history_age := greatest(0,v_as_of-v_history.completed_at::date);
    if v_history.outcome='fully_completed' and v_history_age<=7 then
      v_state := 'settled';
      v_pressure := 'none';
      v_trend := case
        when v_history.condition_before in ('heavy','reset') then 'improving'
        else 'unknown'
      end;
      v_freshness := 'estimated';
      v_source_kind := 'completion';
      v_observed_at := v_history.completed_at;
      v_estimated_minutes := v_history.remaining_minutes_after;
      v_reason := jsonb_build_object(
        'basis','recent_completed_intervention',
        'maintenance_history_id',v_history.id,
        'completion_age_days',v_history_age,
        'outcome',v_history.outcome
      );
    else
      v_reason := jsonb_strip_nulls(jsonb_build_object(
        'basis','no_recent_observation',
        'latest_maintenance_history_id',v_history.id,
        'latest_completion_age_days',v_history_age
      ));
    end if;

  else
    v_reason := jsonb_build_object('basis','no_care_observation');
  end if;

  v_actor_membership_id := atlas.current_membership_id(v_object.farm_id);

  update atlas.object_state
  set care_state=v_state,
      care_pressure=v_pressure,
      care_trend=v_trend,
      care_freshness=v_freshness,
      care_observed_at=v_observed_at,
      care_estimated_recovery_minutes=v_estimated_minutes,
      care_source_kind=v_source_kind,
      care_reason=v_reason,
      care_updated_at=now(),
      updated_at=now()
  where object_id=v_object.id;

  if v_old.care_state is distinct from v_state
    or v_old.care_pressure is distinct from v_pressure
    or v_old.care_trend is distinct from v_trend
    or v_old.care_freshness is distinct from v_freshness
  then
    insert into atlas.care_state_history(
      farm_id,zone_id,object_id,
      previous_state,resulting_state,
      previous_strategy,resulting_strategy,
      previous_pressure,resulting_pressure,
      previous_trend,resulting_trend,
      previous_freshness,resulting_freshness,
      source_kind,source_observation_id,source_maintenance_history_id,
      source_task_id,actor_membership_id,reason,metadata
    )
    values(
      v_object.farm_id,v_object.zone_id,v_object.id,
      v_old.care_state,v_state,
      v_old.care_strategy,v_old.care_strategy,
      v_old.care_pressure,v_pressure,
      v_old.care_trend,v_trend,
      v_old.care_freshness,v_freshness,
      v_source_kind,
      case when v_has_observation then v_observation.id else null end,
      case when v_source_kind='completion' and v_has_history then v_history.id else null end,
      case
        when v_source_kind='completion' and v_has_history
          then v_history.source_task_id
        when v_has_observation
          then v_observation.source_task_id
        else null
      end,
      v_actor_membership_id,
      v_reason,
      jsonb_build_object('derived_as_of',v_as_of)
    );
  end if;

  return jsonb_build_object(
    'objectId',v_object.id,
    'careState',v_state,
    'careStrategy',v_old.care_strategy,
    'carePressure',v_pressure,
    'careTrend',v_trend,
    'careFreshness',v_freshness,
    'careObservedAt',v_observed_at,
    'estimatedRecoveryMinutes',v_estimated_minutes
  );
end
$function$;

create or replace function atlas.refresh_farm_care_state_v1(
  p_farm_id uuid,
  p_as_of date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select distinct mo.object_id
    from atlas.maintenance_objects mo
    where mo.farm_id=p_farm_id
      and mo.active
  loop
    perform atlas.refresh_object_care_state_v1(r.object_id,p_as_of);
    v_count := v_count+1;
  end loop;

  return jsonb_build_object(
    'farmId',p_farm_id,
    'asOfDate',coalesce(p_as_of,current_date),
    'objectsRefreshed',v_count
  );
end
$function$;

create or replace function atlas.record_care_observation_v1(
  p_object_id uuid,
  p_pressure_band text,
  p_intended_shape_readable boolean default null,
  p_function_protected boolean default null,
  p_recovery_required boolean default null,
  p_estimated_recovery_minutes integer default null,
  p_note text default null,
  p_observed_at timestamptz default now(),
  p_source_task_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_object atlas.growing_objects%rowtype;
  v_membership_id uuid;
  v_observation_id uuid;
  v_state jsonb;
begin
  if p_pressure_band not in ('none','light','moderate','heavy','severe','unknown') then
    raise exception 'Unsupported care pressure: %',p_pressure_band
      using errcode='22023';
  end if;

  if p_estimated_recovery_minutes is not null
    and p_estimated_recovery_minutes<0
  then
    raise exception 'Estimated recovery minutes cannot be negative.'
      using errcode='22023';
  end if;

  select *
  into v_object
  from atlas.growing_objects
  where id=p_object_id;

  if not found then
    raise exception 'Growing object % was not found.',p_object_id
      using errcode='P0002';
  end if;

  if not atlas.can_read_farm_operations(v_object.farm_id) then
    raise exception 'Active farm membership is required.'
      using errcode='42501';
  end if;

  v_membership_id := atlas.current_membership_id(v_object.farm_id);
  if v_membership_id is null then
    raise exception 'Active farm membership is required.'
      using errcode='42501';
  end if;

  insert into atlas.care_observations(
    farm_id,zone_id,object_id,observed_at,observed_by_membership_id,
    source_kind,source_task_id,pressure_band,intended_shape_readable,
    function_protected,recovery_required,estimated_recovery_minutes,
    note,metadata
  )
  values(
    v_object.farm_id,v_object.zone_id,v_object.id,
    coalesce(p_observed_at,now()),v_membership_id,
    'field_observation',p_source_task_id,p_pressure_band,
    p_intended_shape_readable,p_function_protected,p_recovery_required,
    p_estimated_recovery_minutes,p_note,coalesce(p_metadata,'{}'::jsonb)
  )
  returning id into v_observation_id;

  v_state := atlas.refresh_object_care_state_v1(
    v_object.id,
    coalesce(p_observed_at,now())::date
  );

  return jsonb_build_object(
    'observationId',v_observation_id,
    'state',v_state
  );
end
$function$;

create or replace function atlas.set_object_care_strategy_v1(
  p_object_id uuid,
  p_strategy text,
  p_review_on date default null,
  p_reason text default null,
  p_source text default 'manager_decision'
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_object atlas.growing_objects%rowtype;
  v_membership_id uuid;
  v_previous atlas.object_state%rowtype;
  v_result atlas.object_state%rowtype;
begin
  if p_strategy not in (
    'active_hand_care','targeted_recovery','mow_and_hold',
    'suppressed_by_tarp','mulch_hold','cover_crop_hold',
    'resting_until_review','redesign_pending','removal_pending','unknown'
  ) then
    raise exception 'Unsupported care strategy: %',p_strategy
      using errcode='22023';
  end if;

  select *
  into v_object
  from atlas.growing_objects
  where id=p_object_id;

  if not found then
    raise exception 'Growing object % was not found.',p_object_id
      using errcode='P0002';
  end if;

  if not atlas.is_farm_manager_or_owner(v_object.farm_id) then
    raise exception 'Manager or Owner membership is required.'
      using errcode='42501';
  end if;

  v_membership_id := atlas.current_membership_id(v_object.farm_id);

  insert into atlas.object_state(object_id,farm_id)
  values(v_object.id,v_object.farm_id)
  on conflict(object_id) do nothing;

  select *
  into v_previous
  from atlas.object_state
  where object_id=v_object.id
  for update;

  update atlas.object_state
  set care_strategy=p_strategy,
      care_review_on=p_review_on,
      care_strategy_source=coalesce(nullif(p_source,''),'manager_decision'),
      care_strategy_set_at=now(),
      care_strategy_set_by_membership_id=v_membership_id,
      care_reason=coalesce(care_reason,'{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object(
          'strategy_reason',p_reason,
          'strategy_source',coalesce(nullif(p_source,''),'manager_decision')
        )),
      care_updated_at=now(),
      updated_at=now()
  where object_id=v_object.id;

  perform atlas.refresh_object_care_state_v1(v_object.id,current_date);

  if not atlas.care_strategy_allows_ordinary_weeding_v1(
    v_object.id,
    current_date
  ) then
    update atlas.planned_work_occurrences o
    set state='cancelled',
        metadata=coalesce(o.metadata,'{}'::jsonb)
          || jsonb_build_object(
            'cancelled_by','set_object_care_strategy_v1',
            'cancelled_at',now(),
            'cancelled_reason','Object care strategy does not allow ordinary hand weeding.'
          ),
        updated_at=now()
    from atlas.maintenance_objects mo
    where mo.object_id=v_object.id
      and mo.maintenance_type='weed'
      and o.source_kind='maintenance_weeding_collection'
      and o.source_id=mo.id
      and o.state in ('planned','eligible','failed','releasing');

    update atlas.tasks t
    set status='skipped',
        completed_at=coalesce(t.completed_at,now()),
        completed_by=coalesce(t.completed_by,'care_strategy'),
        blocker_text=null,
        metadata=coalesce(t.metadata,'{}'::jsonb)
          || jsonb_build_object(
            'suppressed_by','set_object_care_strategy_v1',
            'suppressed_at',now(),
            'suppressed_reason','Object care strategy does not allow ordinary hand weeding.'
          ),
        updated_at=now()
    from atlas.maintenance_objects mo
    where mo.object_id=v_object.id
      and mo.maintenance_type='weed'
      and t.generated_from='maintenance_weeding_collection'
      and t.generated_from_id=mo.id
      and t.status in ('open','blocked');
  end if;

  select *
  into v_result
  from atlas.object_state
  where object_id=v_object.id;

  if v_previous.care_strategy is distinct from v_result.care_strategy then
    insert into atlas.care_state_history(
      farm_id,zone_id,object_id,
      previous_state,resulting_state,
      previous_strategy,resulting_strategy,
      previous_pressure,resulting_pressure,
      previous_trend,resulting_trend,
      previous_freshness,resulting_freshness,
      source_kind,actor_membership_id,reason,metadata
    )
    values(
      v_object.farm_id,v_object.zone_id,v_object.id,
      v_previous.care_state,v_result.care_state,
      v_previous.care_strategy,v_result.care_strategy,
      v_previous.care_pressure,v_result.care_pressure,
      v_previous.care_trend,v_result.care_trend,
      v_previous.care_freshness,v_result.care_freshness,
      'strategy',v_membership_id,
      jsonb_strip_nulls(jsonb_build_object(
        'reason',p_reason,
        'source',coalesce(nullif(p_source,''),'manager_decision'),
        'review_on',p_review_on
      )),
      '{}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'objectId',v_result.object_id,
    'careState',v_result.care_state,
    'careStrategy',v_result.care_strategy,
    'carePressure',v_result.care_pressure,
    'careTrend',v_result.care_trend,
    'careFreshness',v_result.care_freshness,
    'reviewOn',v_result.care_review_on
  );
end
$function$;

create or replace function atlas.refresh_care_state_from_observation_v1()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
begin
  perform atlas.refresh_object_care_state_v1(
    new.object_id,
    new.observed_at::date
  );
  return new;
end
$function$;

drop trigger if exists refresh_care_state_from_observation_v1
  on atlas.care_observations;
create trigger refresh_care_state_from_observation_v1
after insert or update of
  observed_at,pressure_band,intended_shape_readable,function_protected,
  recovery_required,estimated_recovery_minutes
on atlas.care_observations
for each row
execute function atlas.refresh_care_state_from_observation_v1();

create or replace function atlas.refresh_care_state_from_completion_v1()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
begin
  perform atlas.refresh_object_care_state_v1(
    new.object_id,
    new.completed_at::date
  );
  return new;
end
$function$;

drop trigger if exists refresh_care_state_from_completion_v1
  on atlas.maintenance_history;
create trigger refresh_care_state_from_completion_v1
after insert
on atlas.maintenance_history
for each row
execute function atlas.refresh_care_state_from_completion_v1();

create or replace function atlas.guard_care_strategy_weeding_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_object_id uuid;
begin
  if new.source_kind='maintenance_weeding_collection'
    and new.source_id is not null
    and new.state in ('planned','eligible','failed','releasing')
  then
    select object_id
    into v_object_id
    from atlas.maintenance_objects
    where id=new.source_id;

    if v_object_id is not null
      and not atlas.care_strategy_allows_ordinary_weeding_v1(
        v_object_id,
        coalesce(new.planned_due_date,current_date)
      )
    then
      new.state := 'cancelled';
      new.metadata := coalesce(new.metadata,'{}'::jsonb)
        || jsonb_build_object(
          'cancelled_by','farm_care_strategy_guard',
          'cancelled_at',now(),
          'cancelled_reason','Object care strategy does not allow ordinary hand weeding.'
        );
    end if;
  end if;

  return new;
end
$function$;

drop trigger if exists guard_care_strategy_weeding_occurrence_v1
  on atlas.planned_work_occurrences;
create trigger guard_care_strategy_weeding_occurrence_v1
before insert or update of
  source_kind,source_id,state,planned_due_date
on atlas.planned_work_occurrences
for each row
execute function atlas.guard_care_strategy_weeding_occurrence_v1();

create or replace function atlas.guard_care_strategy_weeding_task_v1()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_object_id uuid;
begin
  if new.generated_from='maintenance_weeding_collection'
    and new.generated_from_id is not null
    and new.status in ('open','blocked')
  then
    select object_id
    into v_object_id
    from atlas.maintenance_objects
    where id=new.generated_from_id;

    if v_object_id is not null
      and not atlas.care_strategy_allows_ordinary_weeding_v1(
        v_object_id,
        coalesce(new.due_date,current_date)
      )
    then
      if tg_op='INSERT' then
        raise exception
          'Ordinary weeding is not allowed by the object care strategy.'
          using errcode='23514';
      end if;

      new.status := 'skipped';
      new.completed_at := coalesce(new.completed_at,now());
      new.completed_by := coalesce(new.completed_by,'farm_care_strategy_guard');
      new.blocker_text := null;
      new.metadata := coalesce(new.metadata,'{}'::jsonb)
        || jsonb_build_object(
          'suppressed_by','farm_care_strategy_guard',
          'suppressed_at',now(),
          'suppressed_reason','Object care strategy does not allow ordinary hand weeding.'
        );
    end if;
  end if;

  return new;
end
$function$;

drop trigger if exists guard_care_strategy_weeding_task_v1
  on atlas.tasks;
create trigger guard_care_strategy_weeding_task_v1
before insert or update of
  generated_from,generated_from_id,status,due_date
on atlas.tasks
for each row
execute function atlas.guard_care_strategy_weeding_task_v1();

-- Ensure every currently maintainable growing object has a canonical object-state row.
insert into atlas.object_state(object_id,farm_id)
select distinct mo.object_id,mo.farm_id
from atlas.maintenance_objects mo
where mo.active
on conflict(object_id) do nothing;

-- Preserve factual legacy condition reports as observations. Age-only estimates are
-- deliberately not migrated as observations.
insert into atlas.care_observations(
  farm_id,zone_id,object_id,observed_at,source_kind,source_key,
  pressure_band,intended_shape_readable,function_protected,
  recovery_required,estimated_recovery_minutes,note,metadata
)
select
  mo.farm_id,
  mo.zone_id,
  mo.object_id,
  mo.condition_reported_at,
  'legacy_condition',
  'legacy-maintenance-condition:'||mo.id::text||':'||mo.condition_reported_at::text,
  case mo.condition
    when 'maintained' then 'none'
    when 'moderate' then 'moderate'
    when 'heavy' then 'heavy'
    when 'reset' then 'severe'
    else 'unknown'
  end,
  case mo.condition
    when 'maintained' then true
    when 'moderate' then true
    when 'heavy' then false
    when 'reset' then false
    else null
  end,
  case mo.condition
    when 'maintained' then true
    when 'moderate' then true
    when 'heavy' then false
    when 'reset' then false
    else null
  end,
  mo.condition='reset',
  mo.remaining_effort_minutes,
  'Migrated from an attributable maintenance condition report.',
  jsonb_build_object(
    'maintenance_object_id',mo.id,
    'legacy_condition',mo.condition,
    'migration','farm_care_phase1'
  )
from atlas.maintenance_objects mo
where mo.active
  and mo.maintenance_type='weed'
  and mo.condition_reported_at is not null
on conflict(source_key) do nothing;

-- Explicit current product decisions from the controlling Farm Care specification.
update atlas.object_state os
set care_strategy='resting_until_review',
    care_review_on=date '2026-09-18',
    care_strategy_source='owner_instruction_20260722',
    care_strategy_set_at=now(),
    care_reason=coalesce(os.care_reason,'{}'::jsonb)
      || jsonb_build_object(
        'strategy_reason','Fence Line remains outside current recovery work.',
        'strategy_source','owner_instruction_20260722'
      ),
    care_updated_at=now(),
    updated_at=now()
from atlas.growing_objects go
where go.id=os.object_id
  and go.stable_key='lilac_haven_fence_line';

update atlas.object_state os
set care_strategy='targeted_recovery',
    care_strategy_source='farm_care_build_spec_20260722',
    care_strategy_set_at=now(),
    care_reason=coalesce(os.care_reason,'{}'::jsonb)
      || jsonb_build_object(
        'strategy_reason','Compact recovery intervention; ordinary recurrence pauses.',
        'strategy_source','farm_care_build_spec_20260722'
      ),
    care_updated_at=now(),
    updated_at=now()
from atlas.growing_objects go
where go.id=os.object_id
  and go.stable_key='house_south_foundation_border_west';

insert into atlas.care_observations(
  farm_id,zone_id,object_id,observed_at,source_kind,source_key,
  pressure_band,intended_shape_readable,function_protected,
  recovery_required,estimated_recovery_minutes,note,metadata
)
select
  go.farm_id,
  go.zone_id,
  go.id,
  timestamptz '2026-07-22 12:00:00-05',
  'controlling_spec',
  'farm-care-spec:south-perennial-garden:2026-07-22',
  'heavy',
  false,
  false,
  true,
  28,
  'South Perennial Garden needs a compact recovery intervention before its planned next use.',
  jsonb_build_object(
    'source','Atlas Farm Care Build Specification',
    'migration','farm_care_phase1'
  )
from atlas.growing_objects go
where go.stable_key='house_south_foundation_border_west'
on conflict(source_key) do nothing;

-- Backfill the canonical state for all active maintainable objects.
do $backfill$
declare
  v_farm_id uuid;
begin
  select id
  into v_farm_id
  from atlas.farms
  where stable_key='elm_farm';

  if v_farm_id is not null then
    perform atlas.refresh_farm_care_state_v1(v_farm_id,date '2026-07-22');
  end if;
end
$backfill$;

-- Retire any already-released Fence Line hand-weeding card and cancel unreleased
-- occurrences. The strategy—not the task queue—is now authoritative.
update atlas.tasks t
set status='skipped',
    completed_at=coalesce(t.completed_at,now()),
    completed_by=coalesce(t.completed_by,'farm_care_phase1'),
    blocker_text=null,
    metadata=coalesce(t.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'suppressed_by','farm_care_phase1',
        'suppressed_at',now(),
        'suppressed_reason','Fence Line is resting until the September 18 review.'
      ),
    updated_at=now()
from atlas.maintenance_objects mo
join atlas.growing_objects go on go.id=mo.object_id
where t.generated_from='maintenance_weeding_collection'
  and t.generated_from_id=mo.id
  and go.stable_key='lilac_haven_fence_line'
  and t.status in ('open','blocked');

update atlas.planned_work_occurrences o
set state='cancelled',
    metadata=coalesce(o.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'cancelled_by','farm_care_phase1',
        'cancelled_at',now(),
        'cancelled_reason','Fence Line is resting until the September 18 review.'
      ),
    updated_at=now()
from atlas.maintenance_objects mo
join atlas.growing_objects go on go.id=mo.object_id
where o.source_kind='maintenance_weeding_collection'
  and o.source_id=mo.id
  and go.stable_key='lilac_haven_fence_line'
  and o.state in ('planned','eligible','failed','releasing');

create or replace view atlas.farm_care_object_state_v1
with (security_invoker=true)
as
select
  go.farm_id,
  go.zone_id,
  z.stable_key as zone_key,
  z.label as zone_label,
  go.id as object_id,
  go.stable_key as object_key,
  go.label as object_label,
  go.object_type,
  os.care_state,
  os.care_strategy,
  os.care_pressure,
  os.care_trend,
  case
    when os.care_source_kind='observation'
      and os.care_observed_at is not null
      and current_date-os.care_observed_at::date>21
      then 'stale'
    else os.care_freshness
  end as care_freshness,
  os.care_observed_at,
  case
    when os.care_observed_at is null then null
    else greatest(0,current_date-os.care_observed_at::date)
  end as observation_age_days,
  os.care_review_on,
  os.care_estimated_recovery_minutes,
  os.care_source_kind,
  os.care_strategy_source,
  os.care_reason,
  atlas.care_strategy_allows_ordinary_weeding_v1(
    go.id,
    current_date
  ) as ordinary_weeding_allowed,
  os.care_updated_at
from atlas.growing_objects go
join atlas.object_state os on os.object_id=go.id
left join atlas.zones z on z.id=go.zone_id
where exists(
  select 1
  from atlas.maintenance_objects mo
  where mo.object_id=go.id
    and mo.active
);

grant select on atlas.farm_care_object_state_v1 to authenticated;

comment on column atlas.object_state.care_state is
  'Canonical Farm Care state for this physical object. Tasks must not define this value.';
comment on column atlas.object_state.care_strategy is
  'Management strategy governing which interventions are valid for this object.';
comment on table atlas.care_observations is
  'Attributable physical observations used to derive canonical Farm Care state.';
comment on table atlas.care_state_history is
  'Attributable prior/resulting Farm Care state transitions.';
comment on view atlas.farm_care_object_state_v1 is
  'Phase 1 prepared read path for canonical object care state.';

revoke all on function atlas.care_pressure_rank_v1(text) from public;
revoke all on function atlas.care_strategy_allows_ordinary_weeding_v1(uuid,date) from public;
revoke all on function atlas.refresh_object_care_state_v1(uuid,date) from public;
revoke all on function atlas.refresh_farm_care_state_v1(uuid,date) from public;
revoke all on function atlas.refresh_care_state_from_observation_v1() from public;
revoke all on function atlas.refresh_care_state_from_completion_v1() from public;
revoke all on function atlas.guard_care_strategy_weeding_occurrence_v1() from public;
revoke all on function atlas.guard_care_strategy_weeding_task_v1() from public;
revoke all on function atlas.record_care_observation_v1(
  uuid,text,boolean,boolean,boolean,integer,text,timestamptz,uuid,jsonb
) from public;
revoke all on function atlas.set_object_care_strategy_v1(
  uuid,text,date,text,text
) from public;

grant execute on function atlas.record_care_observation_v1(
  uuid,text,boolean,boolean,boolean,integer,text,timestamptz,uuid,jsonb
) to authenticated;
grant execute on function atlas.set_object_care_strategy_v1(
  uuid,text,date,text,text
) to authenticated;
