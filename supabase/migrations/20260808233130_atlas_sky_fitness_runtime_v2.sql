create or replace function atlas.sky_rule_state_complete_v1(p_predicate jsonb, p_state jsonb)
returns boolean
language plpgsql
immutable
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_pred jsonb := coalesce(p_predicate,'{}'::jsonb);
  v_state jsonb := coalesce(p_state,'{}'::jsonb);
begin
  if v_pred ? 'moon_sign_in' and nullif(v_state->>'moonSign','') is null then return false; end if;
  if v_pred ? 'moon_mode_in' and nullif(v_state->>'moonMode','') is null then return false; end if;
  if v_pred ? 'phase_state_in' and nullif(v_state->>'phaseState','') is null then return false; end if;
  if (v_pred ? 'illumination_min' or v_pred ? 'illumination_max') and nullif(v_state->>'illuminationFraction','') is null then return false; end if;
  return true;
end;
$$;

create or replace function atlas.sky_state_at_v2(p_farm_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_at timestamptz := coalesce(p_at,now());
  v_sign atlas.sky_windows%rowtype;
  v_mode atlas.sky_windows%rowtype;
  v_phase atlas.sky_windows%rowtype;
  v_sample atlas.sky_state_samples%rowtype;
  v_covered boolean := false;
begin
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_sign from atlas.sky_windows w
  where w.farm_id=p_farm_id and w.window_kind='moon_sign'
    and w.starts_at <= v_at and v_at < w.ends_at
  order by w.generated_at desc,w.starts_at desc limit 1;

  select * into v_mode from atlas.sky_windows w
  where w.farm_id=p_farm_id and w.window_kind='moon_mode'
    and w.starts_at <= v_at and v_at < w.ends_at
  order by w.generated_at desc,w.starts_at desc limit 1;

  select * into v_phase from atlas.sky_windows w
  where w.farm_id=p_farm_id and w.window_kind='moon_phase_half'
    and w.starts_at <= v_at and v_at < w.ends_at
  order by w.generated_at desc,w.starts_at desc limit 1;

  select * into v_sample from atlas.sky_state_samples s
  where s.farm_id=p_farm_id
    and abs(extract(epoch from (s.sampled_at-v_at))) <= 64800
  order by abs(extract(epoch from (s.sampled_at-v_at))) asc,s.generated_at desc
  limit 1;

  v_covered := v_sign.id is not null and v_mode.id is not null and v_phase.id is not null and v_sample.id is not null;

  return jsonb_build_object(
    'contractVersion','sky_state_at_v2',
    'farmId',p_farm_id,
    'at',v_at,
    'covered',v_covered,
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
$$;

create or replace function atlas.next_sky_rule_match_v1(p_rule_id uuid, p_after timestamptz default now(), p_horizon_days integer default 120)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_rule atlas.sky_operation_rules%rowtype;
  v_after timestamptz := coalesce(p_after,now());
  v_horizon timestamptz := v_after + make_interval(days => greatest(1,least(coalesce(p_horizon_days,120),180)));
  v_state jsonb;
  v_prev_match boolean := false;
  v_match boolean := false;
  v_started_at timestamptz;
  v_boundary timestamptz;
  v_end_at timestamptz;
begin
  select * into v_rule from atlas.sky_operation_rules where id=p_rule_id;
  if v_rule.id is null then return null; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_rule.farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  v_state := atlas.sky_state_at_v2(v_rule.farm_id,v_after);
  v_prev_match := atlas.sky_rule_state_complete_v1(v_rule.predicate,v_state)
                  and atlas.sky_rule_matches_v1(v_rule.predicate,v_state);
  if v_prev_match then v_started_at := v_after; end if;

  for v_boundary in
    select boundary_at
    from (
      select w.starts_at as boundary_at from atlas.sky_windows w
       where w.farm_id=v_rule.farm_id and w.starts_at>v_after and w.starts_at<=v_horizon
      union
      select w.ends_at from atlas.sky_windows w
       where w.farm_id=v_rule.farm_id and w.ends_at>v_after and w.ends_at<=v_horizon
      union
      select s.sampled_at from atlas.sky_state_samples s
       where s.farm_id=v_rule.farm_id and s.sampled_at>v_after and s.sampled_at<=v_horizon
    ) b
    order by boundary_at
  loop
    v_state := atlas.sky_state_at_v2(v_rule.farm_id,v_boundary + interval '2 seconds');
    v_match := atlas.sky_rule_state_complete_v1(v_rule.predicate,v_state)
               and atlas.sky_rule_matches_v1(v_rule.predicate,v_state);

    if not v_prev_match and v_match and v_started_at is null then
      v_started_at := v_boundary;
    elsif v_prev_match and not v_match and v_started_at is not null then
      v_end_at := v_boundary;
      exit;
    end if;
    v_prev_match := v_match;
  end loop;

  if v_started_at is null then return null; end if;
  if v_end_at is null then
    select min(x) into v_end_at from (
      select max(w.ends_at) x from atlas.sky_windows w where w.farm_id=v_rule.farm_id and w.starts_at<=v_horizon
      union all select v_horizon
    ) q;
  end if;

  return jsonb_build_object('startsAt',v_started_at,'endsAt',v_end_at,'ruleId',v_rule.id,'ruleKey',v_rule.stable_key);
end;
$$;

create or replace function atlas.task_sky_fitness_v2(p_task_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_rule atlas.sky_operation_rules%rowtype;
  v_state jsonb;
  v_matches boolean;
  v_complete boolean;
  v_fitness text;
  v_eligible boolean := true;
  v_match_window jsonb;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_task.farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  v_state := atlas.sky_state_at_v2(v_task.farm_id,coalesce(p_at,now()));

  select * into v_rule
  from atlas.sky_operation_rules r
  where r.farm_id=v_task.farm_id
    and r.operation_class=v_task.operation_class
    and r.active
    and r.status='approved'
    and (r.valid_from is null or r.valid_from <= (coalesce(p_at,now()) at time zone coalesce(nullif(v_task.metadata->>'timezone',''),(select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') from atlas.farms f where f.id=v_task.farm_id),'America/Chicago'))::date)
    and (r.valid_until is null or r.valid_until >= (coalesce(p_at,now()) at time zone coalesce(nullif(v_task.metadata->>'timezone',''),(select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') from atlas.farms f where f.id=v_task.farm_id),'America/Chicago'))::date)
    and (v_task.metadata->>'sky_rule_key_manual' is null or r.stable_key=v_task.metadata->>'sky_rule_key_manual')
  order by r.priority asc,r.rule_version desc,r.created_at desc
  limit 1;

  if v_task.operation_class is null then
    return jsonb_build_object('contractVersion','task_sky_fitness_v2','taskId',v_task.id,'operationClass',null,'fitness','unclassified','enforcementMode','informative','eligibleUnderSky',true,'state',v_state);
  end if;

  if coalesce(v_task.metadata->>'sky_timing_mode','')='ignore' then
    return jsonb_build_object('contractVersion','task_sky_fitness_v2','taskId',v_task.id,'operationClass',v_task.operation_class,'fitness','owner_override','enforcementMode','informative','eligibleUnderSky',true,'overrideReason','task_sky_timing_mode_ignore','state',v_state);
  end if;

  if v_rule.id is null then
    return jsonb_build_object('contractVersion','task_sky_fitness_v2','taskId',v_task.id,'operationClass',v_task.operation_class,'fitness','unruled','enforcementMode','informative','eligibleUnderSky',true,'state',v_state);
  end if;

  v_complete := atlas.sky_rule_state_complete_v1(v_rule.predicate,v_state);
  if not v_complete then
    return jsonb_build_object(
      'contractVersion','task_sky_fitness_v2','taskId',v_task.id,'operationClass',v_task.operation_class,
      'fitness','unknown_sky_state','enforcementMode',v_rule.enforcement_mode,'eligibleUnderSky',true,
      'failOpen',true,'rule',jsonb_build_object('id',v_rule.id,'stableKey',v_rule.stable_key,'version',v_rule.rule_version,'evidenceClass',v_rule.evidence_class),
      'state',v_state
    );
  end if;

  v_matches := atlas.sky_rule_matches_v1(v_rule.predicate,v_state);
  v_fitness := case when v_matches then v_rule.fitness_when_match else v_rule.fitness_when_no_match end;
  v_eligible := not (v_rule.enforcement_mode='windowed' and v_fitness in ('unfavored','avoid','neutral'));
  v_match_window := atlas.next_sky_rule_match_v1(v_rule.id,coalesce(p_at,now()),120);

  return jsonb_build_object(
    'contractVersion','task_sky_fitness_v2','taskId',v_task.id,'operationClass',v_task.operation_class,
    'fitness',v_fitness,'ruleMatched',v_matches,'enforcementMode',v_rule.enforcement_mode,'eligibleUnderSky',v_eligible,
    'favoredWindowStart',v_match_window->>'startsAt','favoredWindowEnd',v_match_window->>'endsAt',
    'rule',jsonb_build_object('id',v_rule.id,'stableKey',v_rule.stable_key,'version',v_rule.rule_version,'evidenceClass',v_rule.evidence_class,'sourceSummary',v_rule.source_summary),
    'state',v_state
  );
end;
$$;

create or replace function atlas.task_sky_presentation_gate_v1(p_task_id uuid, p_work_date date default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_timezone text := 'America/Chicago';
  v_day date;
  v_today date;
  v_at timestamptz;
  v_fitness jsonb;
  v_withheld boolean := false;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone from atlas.farms f where f.id=v_task.farm_id;
  v_day := coalesce(p_work_date,(now() at time zone v_timezone)::date);
  v_today := (now() at time zone v_timezone)::date;
  v_at := case when v_day=v_today then now() else (v_day::timestamp + time '12:00') at time zone v_timezone end;
  v_fitness := atlas.task_sky_fitness_v2(v_task.id,v_at);

  v_withheld := v_task.status='open'
    and v_task.commitment_kind='floating'
    and v_task.due_date is null
    and coalesce(v_fitness->>'enforcementMode','informative')='windowed'
    and coalesce((v_fitness->>'eligibleUnderSky')::boolean,true)=false;

  return jsonb_build_object(
    'contractVersion','task_sky_presentation_gate_v1','taskId',v_task.id,'workDate',v_day,'evaluatedAt',v_at,
    'withheldUnderSky',v_withheld,
    'presentationReason',case when v_withheld then 'awaiting_favored_sky_window' else null end,
    'nextEligibleAt',v_fitness->>'favoredWindowStart','nextEligibleUntil',v_fitness->>'favoredWindowEnd',
    'fitness',v_fitness
  );
end;
$$;

create or replace function atlas.sky_ledger_status_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_sample_count integer;
  v_window_count integer;
  v_from date;
  v_through date;
  v_latest timestamptz;
  v_calc text;
begin
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  select count(*)::integer,min(service_date),max(service_date),max(generated_at) into v_sample_count,v_from,v_through,v_latest from atlas.sky_state_samples where farm_id=p_farm_id;
  select count(*)::integer into v_window_count from atlas.sky_windows where farm_id=p_farm_id;
  select calculation_version into v_calc from atlas.sky_state_samples where farm_id=p_farm_id order by generated_at desc limit 1;
  return jsonb_build_object('contractVersion','sky_ledger_status_v1','farmId',p_farm_id,'sampleCount',coalesce(v_sample_count,0),'windowCount',coalesce(v_window_count,0),'coverageFrom',v_from,'coverageThrough',v_through,'latestGeneratedAt',v_latest,'calculationVersion',v_calc);
end;
$$;

revoke all on function atlas.sky_state_at_v2(uuid,timestamptz) from public;
revoke all on function atlas.task_sky_fitness_v2(uuid,timestamptz) from public;
revoke all on function atlas.task_sky_presentation_gate_v1(uuid,date) from public;
revoke all on function atlas.sky_ledger_status_v1(uuid) from public;
grant execute on function atlas.sky_state_at_v2(uuid,timestamptz) to authenticated,service_role;
grant execute on function atlas.task_sky_fitness_v2(uuid,timestamptz) to authenticated,service_role;
grant execute on function atlas.task_sky_presentation_gate_v1(uuid,date) to authenticated,service_role;
grant execute on function atlas.sky_ledger_status_v1(uuid) to authenticated,service_role;
