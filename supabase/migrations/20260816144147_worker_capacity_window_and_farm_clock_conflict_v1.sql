create or replace function atlas.worker_capacity_window_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_day date;
  v_capacity jsonb;
  v_reservations jsonb;
  v_days jsonb := '[]'::jsonb;
  v_known_days integer := 0;
  v_anchor_days integer := 0;
  v_policy_conflict_days integer := 0;
  v_planned integer := 0;
  v_recovery integer := 0;
  v_maximum integer := 0;
  v_heavy_cap integer := 0;
  v_placed integer := 0;
  v_placed_heavy integer := 0;
  v_remaining_planned integer := 0;
  v_remaining_recovery integer := 0;
  v_remaining_maximum integer := 0;
  v_remaining_heavy integer := 0;
  v_human_blocks integer := 0;
  v_human_block_minutes integer := 0;
  v_day_placed integer;
  v_day_heavy integer;
  v_day_remaining_planned integer;
  v_day_remaining_recovery integer;
  v_day_remaining_maximum integer;
  v_day_remaining_heavy integer;
  v_state text;
begin
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'A valid inclusive capacity date window is required.' using errcode='22023';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
  ) then
    raise exception 'Active worker membership required.' using errcode='P0002';
  end if;

  for v_day in
    select d::date from generate_series(p_start_date,p_end_date,interval '1 day') d
  loop
    v_capacity := atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,v_day);
    v_reservations := atlas.worker_human_time_reservations_v1(p_farm_id,p_membership_id,v_day);

    select
      coalesce(sum(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0)),0)::integer,
      coalesce(sum(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0)) filter(where cp.physical_load='heavy'),0)::integer
    into v_day_placed,v_day_heavy
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id=p.task_id
    cross join lateral atlas.task_capacity_plan_v1(t,v_day) cp
    where p.farm_id=p_farm_id
      and p.membership_id=p_membership_id
      and p.service_date=v_day
      and p.state='placed'
      and t.status in ('open','blocked');

    if coalesce((v_capacity->>'capacityKnown')::boolean,false) then
      v_known_days := v_known_days + 1;
      v_planned := v_planned + coalesce((v_capacity->>'plannedCapacityMinutes')::integer,0);
      v_recovery := v_recovery + coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0);
      v_maximum := v_maximum + coalesce((v_capacity->>'maximumUsableMinutes')::integer,0);
      v_heavy_cap := v_heavy_cap + coalesce((v_capacity->>'heavyMinutesSoftCap')::integer,0);

      v_day_remaining_planned := greatest(coalesce((v_capacity->>'plannedCapacityMinutes')::integer,0)-v_day_placed,0);
      v_day_remaining_recovery := greatest(coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0)-v_day_placed,0);
      v_day_remaining_maximum := greatest(coalesce((v_capacity->>'maximumUsableMinutes')::integer,0)-v_day_placed,0);
      v_day_remaining_heavy := greatest(coalesce((v_capacity->>'heavyMinutesSoftCap')::integer,0)-v_day_heavy,0);

      v_remaining_planned := v_remaining_planned + v_day_remaining_planned;
      v_remaining_recovery := v_remaining_recovery + v_day_remaining_recovery;
      v_remaining_maximum := v_remaining_maximum + v_day_remaining_maximum;
      v_remaining_heavy := v_remaining_heavy + v_day_remaining_heavy;
    else
      v_day_remaining_planned := null;
      v_day_remaining_recovery := null;
      v_day_remaining_maximum := null;
      v_day_remaining_heavy := null;
      if v_capacity->>'state'='anchor_required' then v_anchor_days := v_anchor_days+1; end if;
      if v_capacity->>'state'='policy_conflict' then v_policy_conflict_days := v_policy_conflict_days+1; end if;
    end if;

    v_placed := v_placed + v_day_placed;
    v_placed_heavy := v_placed_heavy + v_day_heavy;
    v_human_blocks := v_human_blocks + coalesce((v_reservations->>'reservationCount')::integer,0);
    v_human_block_minutes := v_human_block_minutes + coalesce((v_reservations->>'rawCapacityBlockingMinutes')::integer,0);

    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'serviceDate',v_day,
      'capacity',v_capacity,
      'humanTime',v_reservations,
      'committedPlacedMinutes',v_day_placed,
      'committedHeavyMinutes',v_day_heavy,
      'remainingPlannedMinutes',v_day_remaining_planned,
      'remainingRecoveryMinutes',v_day_remaining_recovery,
      'remainingMaximumUsableMinutes',v_day_remaining_maximum,
      'remainingHeavySoftCapMinutes',v_day_remaining_heavy
    ));
  end loop;

  v_state := case
    when v_policy_conflict_days>0 then 'capacity_policy_conflict'
    when v_anchor_days>0 then 'capacity_anchor_required'
    else 'known'
  end;

  return jsonb_build_object(
    'contractVersion','worker_capacity_window_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'startDate',p_start_date,
    'endDate',p_end_date,
    'state',v_state,
    'capacityKnown',v_state='known',
    'knownDayCount',v_known_days,
    'capacityAnchorRequiredDays',v_anchor_days,
    'capacityPolicyConflictDays',v_policy_conflict_days,
    'plannedCapacityMinutes',case when v_state='known' then v_planned else null end,
    'recoveryCapacityMinutes',case when v_state='known' then v_recovery else null end,
    'maximumUsableMinutes',case when v_state='known' then v_maximum else null end,
    'heavyMinutesSoftCap',case when v_state='known' then v_heavy_cap else null end,
    'committedPlacedMinutes',v_placed,
    'committedHeavyMinutes',v_placed_heavy,
    'remainingPlannedMinutes',case when v_state='known' then v_remaining_planned else null end,
    'remainingRecoveryMinutes',case when v_state='known' then v_remaining_recovery else null end,
    'remainingMaximumUsableMinutes',case when v_state='known' then v_remaining_maximum else null end,
    'remainingHeavySoftCapMinutes',case when v_state='known' then v_remaining_heavy else null end,
    'humanTimeReservationCount',v_human_blocks,
    'humanTimeRawBlockingMinutes',v_human_block_minutes,
    'days',v_days
  );
end;
$$;

revoke all on function atlas.worker_capacity_window_v1(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function atlas.worker_capacity_window_v1(uuid,uuid,date,date) to service_role;

create or replace function atlas.worker_weekly_capacity_conflict_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_week jsonb;
  v_week_start date;
  v_week_end date;
  v_capacity jsonb;
  v_required_minutes integer;
  v_required_heavy integer := 0;
  v_required_count integer;
  v_protected_minutes integer;
  v_ready_required_minutes integer := 0;
  v_blocked_required_minutes integer := 0;
  v_available_planned integer;
  v_available_recovery integer;
  v_available_total integer;
  v_heavy_available integer;
  v_missing_planned integer;
  v_missing_including_recovery integer;
  v_heavy_missing integer;
  v_capacity_known boolean;
  v_work_item jsonb;
  v_work jsonb := '[]'::jsonb;
  v_committed jsonb := '[]'::jsonb;
  v_unavailability jsonb := '[]'::jsonb;
  v_conflict boolean := false;
  v_state text;
  v_conflict_class text;
  v_downstream jsonb := '[]'::jsonb;
begin
  v_week := atlas.worker_weekly_farm_contract_v5(p_farm_id,p_membership_id,p_anchor_day);
  v_week_start := (v_week->>'weekStart')::date;
  v_week_end := (v_week->>'weekEnd')::date;
  v_capacity := atlas.worker_capacity_window_v1(p_farm_id,p_membership_id,v_week_start,v_week_end);

  v_required_minutes := coalesce((v_week->>'requiredEstimatedMinutes')::integer,0);
  v_required_count := coalesce((v_week->>'requiredWorkCount')::integer,0);
  v_protected_minutes := coalesce((v_week->>'protectedFarmMinimumEstimatedMinutes')::integer,0);
  v_capacity_known := coalesce((v_capacity->>'capacityKnown')::boolean,false);

  for v_work_item in
    select value from jsonb_array_elements(coalesce(v_week->'work','[]'::jsonb))
  loop
    if coalesce((v_work_item->>'requiredThisWeek')::boolean,false) then
      if v_work_item->>'physicalLoad'='heavy' then
        v_required_heavy := v_required_heavy + coalesce((v_work_item->>'expectedActiveMinutes')::integer,0);
      end if;
      if coalesce((v_work_item->>'executionReady')::boolean,false) then
        v_ready_required_minutes := v_ready_required_minutes + coalesce((v_work_item->>'expectedActiveMinutes')::integer,0);
      else
        v_blocked_required_minutes := v_blocked_required_minutes + coalesce((v_work_item->>'expectedActiveMinutes')::integer,0);
      end if;
      v_downstream := v_downstream || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'taskId',v_work_item->>'taskId',
        'title',v_work_item->>'title',
        'protectedFarmMinimum',v_work_item->'protectedFarmMinimum',
        'consequenceTier',v_work_item->'effectiveConsequenceTier',
        'consequenceClass',v_work_item->>'effectiveConsequenceClass',
        'dueDate',v_work_item->>'dueDate',
        'latestLawfulDate',v_work_item->>'latestLawfulDate',
        'hardFinishDate',v_work_item->>'hardFinishDate'
      )));
    end if;
  end loop;

  if v_capacity_known then
    v_available_planned := coalesce((v_capacity->>'remainingPlannedMinutes')::integer,0);
    v_available_recovery := coalesce((v_capacity->>'remainingRecoveryMinutes')::integer,0);
    v_available_total := v_available_planned + v_available_recovery;
    v_heavy_available := coalesce((v_capacity->>'remainingHeavySoftCapMinutes')::integer,0);
    v_missing_planned := greatest(v_required_minutes-v_available_planned,0);
    v_missing_including_recovery := greatest(v_required_minutes-v_available_total,0);
    v_heavy_missing := greatest(v_required_heavy-v_heavy_available,0);
    v_conflict := v_missing_including_recovery>0 or v_heavy_missing>0;

    v_conflict_class := case
      when v_missing_including_recovery>0 and v_heavy_missing>0 then 'labor_and_physical_load'
      when v_missing_including_recovery>0 then 'labor_capacity'
      when v_heavy_missing>0 then 'physical_load_capacity'
      when v_missing_planned>0 then 'recovery_required_not_planned_feasible'
      else null
    end;

    v_state := case
      when v_conflict then 'conflict'
      when v_missing_planned>0 then 'recovery_required'
      else 'feasible'
    end;
  else
    v_state := case
      when v_capacity->>'state'='capacity_policy_conflict' then 'capacity_policy_conflict'
      else 'capacity_truth_required'
    end;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'placementId',p.id,
    'taskId',p.task_id,
    'title',t.title,
    'serviceDate',p.service_date,
    'plannedStartAt',p.planned_start_at,
    'plannedDurationMinutes',coalesce(p.planned_duration_minutes,cp.expected_active_minutes),
    'physicalLoad',cp.physical_load,
    'placementSource',p.placement_source,
    'placementReason',p.placement_reason
  ) order by p.service_date,p.planned_start_at nulls last,p.sort_order,p.id),'[]'::jsonb)
  into v_committed
  from atlas.worker_day_task_placements p
  join atlas.tasks t on t.id=p.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,p.service_date) cp
  where p.farm_id=p_farm_id and p.membership_id=p_membership_id
    and p.service_date between v_week_start and v_week_end
    and p.state='placed' and t.status in ('open','blocked');

  select coalesce(jsonb_agg(jsonb_build_object(
    'serviceDate',d->>'serviceDate',
    'reservationCount',(d->'humanTime'->>'reservationCount')::integer,
    'rawCapacityBlockingMinutes',(d->'humanTime'->>'rawCapacityBlockingMinutes')::integer,
    'reservations',d->'humanTime'->'reservations'
  ) order by d->>'serviceDate') filter(where coalesce((d->'humanTime'->>'reservationCount')::integer,0)>0),'[]'::jsonb)
  into v_unavailability
  from jsonb_array_elements(coalesce(v_capacity->'days','[]'::jsonb)) d;

  return jsonb_build_object(
    'contractVersion','worker_weekly_capacity_conflict_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'weekStart',v_week_start,
    'weekEnd',v_week_end,
    'state',v_state,
    'hasCapacityConflict',case when v_capacity_known then v_conflict else null end,
    'conflictClass',v_conflict_class,
    'capacityTruth',v_capacity,
    'originatingWorkCount',v_required_count,
    'laborRequiredMinutes',v_required_minutes,
    'readyRequiredMinutes',v_ready_required_minutes,
    'blockedRequiredMinutes',v_blocked_required_minutes,
    'protectedFarmMinimumMinutes',v_protected_minutes,
    'laborAvailablePlannedMinutes',v_available_planned,
    'laborAvailableRecoveryMinutes',v_available_recovery,
    'laborAvailableIncludingRecoveryMinutes',v_available_total,
    'missingPlannedCapacityMinutes',v_missing_planned,
    'missingCapacityIncludingRecoveryMinutes',v_missing_including_recovery,
    'heavyLaborRequiredMinutes',v_required_heavy,
    'heavyLaborAvailableMinutes',v_heavy_available,
    'heavyLoadMissingMinutes',v_heavy_missing,
    'conflictingCommittedWork',v_committed,
    'workerUnavailabilityAndReservations',v_unavailability,
    'weatherCompression',jsonb_build_object(
      'state','unmodeled',
      'known',false,
      'reason','No canonical Atlas weather-capacity service exists yet; Sky timing is not substituted for weather.'
    ),
    'downstreamConsequence',v_downstream,
    'farmTruthMutated',false,
    'conflictIsDerivedEvidence',true
  );
end;
$$;

revoke all on function atlas.worker_weekly_capacity_conflict_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_weekly_capacity_conflict_v1(uuid,uuid,date) to service_role;

create or replace function atlas.owner_worker_weekly_capacity_conflict_api_v1(
  p_farm_id uuid,p_membership_id uuid,p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,atlas,auth
as $$
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner farm membership required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  return atlas.worker_weekly_capacity_conflict_v1(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

revoke all on function atlas.owner_worker_weekly_capacity_conflict_api_v1(uuid,uuid,date) from public,anon;
grant execute on function atlas.owner_worker_weekly_capacity_conflict_api_v1(uuid,uuid,date) to authenticated,service_role;