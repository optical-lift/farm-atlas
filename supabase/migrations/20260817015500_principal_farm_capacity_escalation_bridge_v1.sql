-- Principal Farm Clock capacity escalation bridge v1
-- Delegated work stays inside Farm Clock. Only a governed weekly capacity exception
-- may cross into Principal as structured decision/critical-information state.

create or replace function atlas.sync_worker_weekly_capacity_escalation_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_principal_id uuid;
  v_portfolio_unit_id uuid;
  v_horizon text;
  v_timezone text;
  v_anchor_day date;
  v_conflict jsonb;
  v_state text;
  v_conflict_class text;
  v_week_start date;
  v_week_end date;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_source_id text;
  v_escalation_kind text;
  v_required_minutes integer := 0;
  v_protected_minutes integer := 0;
  v_missing_minutes integer;
  v_heavy_missing_minutes integer;
  v_anchor_required_days integer := 0;
  v_protection_level text := 'standard';
  v_severity text := 'watch';
  v_threshold text;
  v_consequence text;
  v_owner_decision text;
  v_options jsonb := '[]'::jsonb;
  v_current_state jsonb;
  v_recorded jsonb;
begin
  if p_farm_id is null or p_membership_id is null then
    raise exception 'Farm and Farm Hand membership are required.' using errcode='22023';
  end if;

  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.id=p_membership_id
      and fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='P0002';
  end if;

  select u.owner_id, u.id, u.horizon,
         coalesce(nullif(f.metadata->>'timezone',''), nullif(p.home_timezone,''), 'UTC')
    into v_principal_id, v_portfolio_unit_id, v_horizon, v_timezone
  from atlas.portfolio_units u
  join atlas.principals p on p.id=u.owner_id and p.status='active'
  join atlas.farms f on f.id=p_farm_id and f.status='active'
  where u.linked_farm_id=p_farm_id
    and u.archived_at is null
  order by u.created_at, u.id
  limit 1;

  if v_principal_id is null then
    return jsonb_build_object(
      'contractVersion','principal_farm_capacity_escalation_sync_v1',
      'state','principal_portfolio_mapping_required',
      'farmId',p_farm_id,
      'membershipId',p_membership_id,
      'mutated',false
    );
  end if;

  v_anchor_day := coalesce(p_anchor_day, (now() at time zone v_timezone)::date);
  v_conflict := atlas.worker_weekly_capacity_conflict_v1(p_farm_id,p_membership_id,v_anchor_day);
  v_state := v_conflict->>'state';
  v_conflict_class := nullif(v_conflict->>'conflictClass','');
  v_week_start := (v_conflict->>'weekStart')::date;
  v_week_end := (v_conflict->>'weekEnd')::date;
  v_window_start := v_week_start::timestamp at time zone v_timezone;
  v_window_end := (v_week_end + 1)::timestamp at time zone v_timezone;
  v_source_id := p_farm_id::text||':'||p_membership_id::text||':'||v_week_start::text;

  v_required_minutes := coalesce((v_conflict->>'laborRequiredMinutes')::integer,0);
  v_protected_minutes := coalesce((v_conflict->>'protectedFarmMinimumMinutes')::integer,0);
  v_missing_minutes := nullif(v_conflict->>'missingCapacityIncludingRecoveryMinutes','')::integer;
  v_heavy_missing_minutes := nullif(v_conflict->>'heavyLoadMissingMinutes','')::integer;
  v_anchor_required_days := coalesce((v_conflict->'capacityTruth'->>'capacityAnchorRequiredDays')::integer,0);
  v_protection_level := case when v_protected_minutes>0 then 'protected' else 'standard' end;

  -- Resolve older weekly exceptions for this same Farm Hand. A new week must not
  -- leave last week's capacity exception speaking indefinitely.
  update atlas.operational_escalations e
     set status='resolved',
         resolved_at=coalesce(e.resolved_at,now()),
         updated_at=now(),
         metadata=e.metadata||jsonb_build_object(
           'resolutionContract','principal_farm_capacity_escalation_sync_v1',
           'resolutionReason','superseded_by_new_week',
           'resolvedAt',now()
         )
   where e.principal_id=v_principal_id
     and e.source_system='farm_clock'
     and e.source_type='worker_weekly_capacity'
     and e.status in ('open','acknowledged')
     and e.metadata->>'farmId'=p_farm_id::text
     and e.metadata->>'membershipId'=p_membership_id::text
     and e.source_id<>v_source_id;

  if v_state='conflict' then
    v_escalation_kind := 'capacity_breach';
    v_severity := 'material';
    v_threshold := case
      when v_conflict_class is null then 'Required weekly Farm Hand work exceeds governed capacity.'
      else 'Weekly Farm Hand capacity conflict: '||replace(v_conflict_class,'_',' ')||'.'
    end;
    v_consequence := case
      when v_protected_minutes>0 then
        'Required work, including protected farm minimums, cannot fit inside governed Farm Hand capacity without an ownership decision.'
      else
        'Required weekly work cannot fit inside governed Farm Hand capacity without an ownership decision.'
    end;
    v_owner_decision := 'Change capacity, reduce scope, move lawful work, or explicitly accept the stated consequence before the weekly window closes.';
    v_options := jsonb_build_array('add_capacity','reduce_scope','move_lawful_work','accept_consequence');
  elsif v_state in ('capacity_truth_required','capacity_policy_conflict') and v_required_minutes>0 then
    v_escalation_kind := 'missing_critical_information';
    v_severity := case when v_protected_minutes>0 then 'material' else 'watch' end;
    v_threshold := case
      when v_state='capacity_policy_conflict' then 'Farm Hand capacity policy is internally conflicting while required weekly work exists.'
      else 'Farm Hand capacity truth is missing while required weekly work exists.'
    end;
    v_consequence := 'Atlas cannot truthfully determine whether required weekly work fits, so it cannot distinguish a feasible week from a real capacity breach.';
    v_owner_decision := 'Author or repair the Farm Hand Day Shape/capacity truth; do not substitute unfinished-task volume for capacity.';
    v_options := jsonb_build_array('author_worker_day_shape','repair_capacity_policy');
  end if;

  if v_escalation_kind is null then
    update atlas.operational_escalations e
       set status='resolved',
           resolved_at=coalesce(e.resolved_at,now()),
           updated_at=now(),
           metadata=e.metadata||jsonb_build_object(
             'resolutionContract','principal_farm_capacity_escalation_sync_v1',
             'resolutionReason','weekly_capacity_no_longer_requires_principal',
             'resolvedAt',now(),
             'farmClockState',v_state
           )
     where e.principal_id=v_principal_id
       and e.source_system='farm_clock'
       and e.source_type='worker_weekly_capacity'
       and e.source_id=v_source_id
       and e.status in ('open','acknowledged');

    return jsonb_build_object(
      'contractVersion','principal_farm_capacity_escalation_sync_v1',
      'state',v_state,
      'farmId',p_farm_id,
      'membershipId',p_membership_id,
      'weekStart',v_week_start,
      'weekEnd',v_week_end,
      'action','contained_in_farm_clock',
      'mutated',true
    );
  end if;

  -- If the exception changed class (for example unknown capacity became a measured
  -- breach), close the stale class before opening/updating the current one.
  update atlas.operational_escalations e
     set status='resolved',
         resolved_at=coalesce(e.resolved_at,now()),
         updated_at=now(),
         metadata=e.metadata||jsonb_build_object(
           'resolutionContract','principal_farm_capacity_escalation_sync_v1',
           'resolutionReason','weekly_capacity_exception_reclassified',
           'resolvedAt',now(),
           'replacementEscalationKind',v_escalation_kind
         )
   where e.principal_id=v_principal_id
     and e.source_system='farm_clock'
     and e.source_type='worker_weekly_capacity'
     and e.source_id=v_source_id
     and e.escalation_kind<>v_escalation_kind
     and e.status in ('open','acknowledged');

  v_current_state := jsonb_strip_nulls(jsonb_build_object(
    'state',v_state,
    'conflictClass',v_conflict_class,
    'weekStart',v_week_start,
    'weekEnd',v_week_end,
    'originatingWorkCount',v_conflict->'originatingWorkCount',
    'laborRequiredMinutes',v_required_minutes,
    'protectedFarmMinimumMinutes',v_protected_minutes,
    'missingCapacityIncludingRecoveryMinutes',v_missing_minutes,
    'heavyLoadMissingMinutes',v_heavy_missing_minutes,
    'capacityAnchorRequiredDays',v_anchor_required_days,
    'readyRequiredMinutes',v_conflict->'readyRequiredMinutes',
    'blockedRequiredMinutes',v_conflict->'blockedRequiredMinutes',
    'downstreamConsequence',coalesce(v_conflict->'downstreamConsequence','[]'::jsonb),
    'conflictIsDerivedEvidence',true
  ));

  v_recorded := atlas.record_operational_escalation_v1(
    v_principal_id,
    jsonb_build_object(
      'sourceSystem','farm_clock',
      'sourceType','worker_weekly_capacity',
      'sourceId',v_source_id,
      'portfolioUnitStableKey',(select u.stable_key from atlas.portfolio_units u where u.id=v_portfolio_unit_id),
      'escalationKind',v_escalation_kind,
      'currentState',v_current_state,
      'thresholdCrossed',v_threshold,
      'consequence',v_consequence,
      'ownerDecisionRequired',v_owner_decision,
      'options',v_options,
      'severity',v_severity,
      'floorClass',6,
      'protectionLevel',v_protection_level,
      'interruptibility','interruptible',
      'reasonForFloor','A governed Farm Clock exception crossed an explicit Principal escalation threshold.',
      'windowStart',v_window_start,
      'windowEnd',v_window_end,
      'expectedOwnerMinutes',15,
      'horizon',v_horizon,
      'metadata',jsonb_build_object(
        'syncContract','principal_farm_capacity_escalation_sync_v1',
        'farmId',p_farm_id,
        'membershipId',p_membership_id,
        'weekStart',v_week_start,
        'weekEnd',v_week_end,
        'farmTimezone',v_timezone,
        'farmClockState',v_state,
        'delegatedTasksRemainFarmContained',true
      )
    )
  );

  return jsonb_build_object(
    'contractVersion','principal_farm_capacity_escalation_sync_v1',
    'state',v_state,
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'weekStart',v_week_start,
    'weekEnd',v_week_end,
    'action','principal_escalation_recorded',
    'escalationKind',v_escalation_kind,
    'result',v_recorded,
    'mutated',true
  );
end;
$$;

comment on function atlas.sync_worker_weekly_capacity_escalation_v1(uuid,uuid,date) is
  'Internal Farm Clock→Principal bridge. Converts only governed weekly capacity conflict or required-work capacity-truth failure into structured Principal escalation; ordinary unfinished work never crosses directly.';

revoke all on function atlas.sync_worker_weekly_capacity_escalation_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.sync_worker_weekly_capacity_escalation_v1(uuid,uuid,date) to service_role;

create or replace function atlas.tick_worker_weekly_capacity_escalations_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  r record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  for r in
    select distinct
      fm.farm_id,
      fm.id as membership_id,
      coalesce(nullif(f.metadata->>'timezone',''), nullif(p.home_timezone,''), 'UTC') as timezone
    from atlas.farm_memberships fm
    join atlas.farms f on f.id=fm.farm_id and f.status='active'
    join atlas.portfolio_units u on u.linked_farm_id=fm.farm_id and u.archived_at is null
    join atlas.principals p on p.id=u.owner_id and p.status='active'
    where fm.active=true and fm.role='farm_hand'
    order by fm.farm_id,fm.id
  loop
    v_result := atlas.sync_worker_weekly_capacity_escalation_v1(
      r.farm_id,
      r.membership_id,
      (now() at time zone r.timezone)::date
    );
    v_results := v_results || jsonb_build_array(v_result);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'contractVersion','principal_farm_capacity_escalation_tick_v1',
    'processedFarmHands',v_count,
    'results',v_results,
    'ranAt',now()
  );
end;
$$;

comment on function atlas.tick_worker_weekly_capacity_escalations_v1() is
  'Clock tick for linked portfolio farms. Re-evaluates each active Farm Hand weekly capacity state in the farm timezone and synchronizes only earned Principal exceptions.';

revoke all on function atlas.tick_worker_weekly_capacity_escalations_v1() from public, anon, authenticated;
grant execute on function atlas.tick_worker_weekly_capacity_escalations_v1() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='atlas-principal-farm-capacity-escalation-v1' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'atlas-principal-farm-capacity-escalation-v1',
    '17 * * * *',
    'select atlas.tick_worker_weekly_capacity_escalations_v1();'
  );
end
$$;
