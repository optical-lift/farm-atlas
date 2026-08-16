-- Pass 3G / Worker Day Pass 9 — Weekly Farm Contract foundation.
--
-- Governing boundary:
--   * weekly feasibility is evaluated before day assignment;
--   * capacity comes only from Owner-authored Worker Day Shape + real blocking time;
--   * Saturday/Sunday authored capacity is recovery/explicit-override capacity, never normal planned capacity;
--   * task due dates may identify current operational targets but never become invented lawful biological bounds;
--   * this contract is read-only and does not place, move, defer, or complete work.

create or replace function atlas.worker_week_day_capacity_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_role text;
  v_timezone text := 'America/Chicago';
  v_policy_count integer := 0;
  v_policy atlas.worker_day_shape_policies%rowtype;
  v_target integer;
  v_maximum integer;
  v_heavy_cap integer;
  v_start timestamptz;
  v_end timestamptz;
  v_elapsed integer := 0;
  v_blocked integer := 0;
  v_usable integer := 0;
  v_full_day_unavailable boolean := false;
  v_capacity_class text;
begin
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;

  select fm.role into v_role
  from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;
  if v_role is null then
    raise exception 'Active worker membership required.' using errcode='P0002';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms f where f.id=p_farm_id;

  -- Count policies effective for the date before checking weekday membership.
  -- One policy that excludes Saturday/Sunday means a known non-working day;
  -- zero policies means Atlas still lacks the Owner-authored capacity anchor.
  select count(*)::integer into v_policy_count
  from atlas.worker_day_shape_policies p
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id
    and p.active=true
    and p.effective_from<=p_day
    and (p.effective_through is null or p.effective_through>=p_day);

  if v_policy_count=0 then
    return jsonb_build_object(
      'contractVersion','worker_week_day_capacity_v1','serviceDate',p_day,
      'state','anchor_required','capacityKnown',false,'capacityClass','unknown',
      'plannedCapacityMinutes',null,'recoveryCapacityMinutes',null,
      'reason','No Owner-authored Worker Day Shape is effective for this date.'
    );
  elsif v_policy_count>1 then
    return jsonb_build_object(
      'contractVersion','worker_week_day_capacity_v1','serviceDate',p_day,
      'state','policy_conflict','capacityKnown',false,'capacityClass','unknown',
      'plannedCapacityMinutes',null,'recoveryCapacityMinutes',null,
      'matchingPolicyCount',v_policy_count
    );
  end if;

  select p.* into v_policy
  from atlas.worker_day_shape_policies p
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id
    and p.active=true
    and p.effective_from<=p_day
    and (p.effective_through is null or p.effective_through>=p_day)
  order by p.effective_from desc,p.version desc,p.created_at desc
  limit 1;

  if not (extract(dow from p_day)::smallint=any(v_policy.weekdays)) then
    return jsonb_build_object(
      'contractVersion','worker_week_day_capacity_v1','serviceDate',p_day,
      'state','non_working_day','capacityKnown',true,'capacityClass','none',
      'plannedCapacityMinutes',0,'recoveryCapacityMinutes',0,
      'policyId',v_policy.id,'policyVersion',v_policy.version,'weekdays',to_jsonb(v_policy.weekdays)
    );
  end if;

  select
    coalesce(m.regular_target_minutes,case v_role when 'farm_hand' then 420 when 'manager' then 360 else 480 end),
    coalesce(m.maximum_planned_minutes,case v_role when 'farm_hand' then 480 when 'manager' then 480 else 600 end),
    coalesce(m.heavy_minutes_soft_cap,case v_role when 'farm_hand' then 210 when 'manager' then 240 else 300 end)
  into v_target,v_maximum,v_heavy_cap
  from atlas.member_capacity_settings m
  where m.farm_id=p_farm_id and m.membership_id=p_membership_id and m.active=true
  order by m.updated_at desc nulls last,m.created_at desc nulls last
  limit 1;

  v_target:=coalesce(v_target,case v_role when 'farm_hand' then 420 when 'manager' then 360 else 480 end);
  v_maximum:=greatest(coalesce(v_maximum,case v_role when 'farm_hand' then 480 when 'manager' then 480 else 600 end),v_target);
  v_heavy_cap:=greatest(coalesce(v_heavy_cap,case v_role when 'farm_hand' then 210 when 'manager' then 240 else 300 end),0);

  v_start:=(p_day::timestamp+v_policy.local_start) at time zone v_timezone;
  v_end:=(p_day::timestamp+v_policy.local_end) at time zone v_timezone;
  v_elapsed:=greatest((extract(epoch from (v_end-v_start))/60.0)::integer,0);

  v_full_day_unavailable:=exists(
    select 1 from atlas.member_unavailability u
    where u.farm_id=p_farm_id and u.membership_id=p_membership_id and u.active=true
      and p_day between u.unavailable_start and u.unavailable_end
      and u.unavailable_local_start is null and u.unavailable_local_end is null
  );

  if not v_full_day_unavailable then
    with clipped as (
      select tstzrange(greatest(b.starts_at,v_start),least(b.ends_at,v_end),'[)') as span
      from atlas.member_day_capacity_blocks_v1(p_farm_id,p_membership_id,p_day) b
      where b.ends_at>v_start and b.starts_at<v_end
    ), merged as (
      select range_agg(span) as spans from clipped where not isempty(span)
    )
    select coalesce(sum(extract(epoch from (upper(s)-lower(s)))/60.0),0)::integer
    into v_blocked
    from merged cross join lateral unnest(coalesce(merged.spans,'{}'::tstzmultirange)) s;
  end if;

  v_usable:=case when v_full_day_unavailable then 0 else greatest(v_elapsed-v_blocked,0) end;

  -- Recovery capacity is visible but does not make the normal week look feasible.
  v_capacity_class:=case
    when extract(dow from p_day)=6 then 'recovery'
    when extract(dow from p_day)=0 then 'explicit_override'
    else 'planned'
  end;

  return jsonb_build_object(
    'contractVersion','worker_week_day_capacity_v1','serviceDate',p_day,
    'state',case when v_full_day_unavailable then 'unavailable' else 'working_day' end,
    'capacityKnown',true,'capacityClass',v_capacity_class,
    'policyId',v_policy.id,'policyVersion',v_policy.version,'weekdays',to_jsonb(v_policy.weekdays),
    'localStart',v_policy.local_start,'localEnd',v_policy.local_end,
    'shapeElapsedMinutes',v_elapsed,'blockedMinutes',v_blocked,'usableElapsedMinutes',v_usable,
    'configuredPaidTargetMinutes',v_target,'configuredMaximumPlannedMinutes',v_maximum,'heavyMinutesSoftCap',v_heavy_cap,
    'plannedCapacityMinutes',case when v_capacity_class='planned' then least(v_target,v_usable) else 0 end,
    'recoveryCapacityMinutes',case when v_capacity_class in ('recovery','explicit_override') then least(v_target,v_usable) else 0 end,
    'maximumUsableMinutes',least(v_maximum,v_usable),
    'fullDayUnavailable',v_full_day_unavailable
  );
end;
$$;

comment on function atlas.worker_week_day_capacity_v1(uuid,uuid,date) is
  'Weekly Contract day-capacity read. Uses Owner-authored Day Shape and actual blocking time only. Weekend authored capacity is recovery/explicit override, never normal planned capacity.';

create or replace function atlas.worker_weekly_farm_contract_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_week_start date:=date_trunc('week',coalesce(p_anchor_day,(now() at time zone 'America/Chicago')::date)::timestamp)::date;
  v_week_end date;
  v_day date;
  v_day_capacity jsonb;
  v_days jsonb:='[]'::jsonb;
  v_planned_capacity integer:=0;
  v_recovery_capacity integer:=0;
  v_anchor_days integer:=0;
  v_policy_conflict_days integer:=0;
  v_work jsonb:='[]'::jsonb;
  v_required_minutes integer:=0;
  v_optional_minutes integer:=0;
  v_required_unestimated integer:=0;
  v_required_readiness_risks integer:=0;
  v_required_count integer:=0;
  v_optional_count integer:=0;
  v_state text;
  v_missing_minutes integer:=0;
  v_farm_name text;
  v_worker_key text;
begin
  v_week_end:=v_week_start+6;

  select f.name,fm.worker_key into v_farm_name,v_worker_key
  from atlas.farm_memberships fm join atlas.farms f on f.id=fm.farm_id
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;
  if v_farm_name is null then
    raise exception 'Active worker membership required.' using errcode='P0002';
  end if;

  for v_day in select d::date from generate_series(v_week_start,v_week_end,interval '1 day') d loop
    v_day_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,v_day);
    v_days:=v_days||jsonb_build_array(v_day_capacity);
    if v_day_capacity->>'state'='anchor_required' then v_anchor_days:=v_anchor_days+1; end if;
    if v_day_capacity->>'state'='policy_conflict' then v_policy_conflict_days:=v_policy_conflict_days+1; end if;
    if coalesce((v_day_capacity->>'capacityKnown')::boolean,false) then
      v_planned_capacity:=v_planned_capacity+coalesce((v_day_capacity->>'plannedCapacityMinutes')::integer,0);
      v_recovery_capacity:=v_recovery_capacity+coalesce((v_day_capacity->>'recoveryCapacityMinutes')::integer,0);
    end if;
  end loop;

  -- The weekly contract reads the current released execution surface while preserving
  -- durable occurrence provenance. It does not promote task due dates into lawful bounds.
  with candidate_base as (
    select
      t.id as task_id,t.title,t.status,t.due_date,t.work_lane,t.commitment_kind,t.priority,t.planned_occurrence_id,
      o.source_kind,o.source_id,o.planned_due_date as occurrence_target_date,o.earliest_lawful_date,o.preferred_start_date,o.preferred_end_date,o.latest_lawful_date,o.hard_finish_date,o.miss_consequence,o.temporal_contract_source,
      cp.expected_active_minutes,cp.physical_load,cp.effective_obligation_class,
      atlas.task_prerequisites_ready_v1(t.id) as prerequisites_ready,
      atlas.task_required_resources_available_v1(t.id) as resources_ready,
      exists(
        select 1 from atlas.worker_day_task_placements p
        where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.task_id=t.id
          and p.service_date between v_week_start and v_week_end and p.state='placed'
      ) as committed_in_week
    from atlas.tasks t
    left join atlas.planned_work_occurrences o on o.id=t.planned_occurrence_id
    cross join lateral atlas.task_capacity_plan_v1(
      t,
      greatest(v_week_start,least(coalesce(t.due_date,v_week_start),v_week_end))
    ) cp
    where t.farm_id=p_farm_id
      and t.assigned_membership_id=p_membership_id
      and t.status in ('open','blocked')
      and t.visibility_scope<>'system_internal'
      and t.task_scope='farm_operation'
  ), scoped as (
    select b.*,
      (
        b.committed_in_week
        or b.due_date<=v_week_end
        or (b.due_date is null and b.work_lane in ('required','process_continuation','rhythm'))
        or (b.earliest_lawful_date is not null and b.earliest_lawful_date<=v_week_end and coalesce(b.latest_lawful_date,b.hard_finish_date,v_week_end)>=v_week_start)
        or (b.preferred_start_date is not null and b.preferred_start_date<=v_week_end and coalesce(b.preferred_end_date,b.preferred_start_date)>=v_week_start)
        or b.latest_lawful_date<=v_week_end
        or b.hard_finish_date<=v_week_end
      ) as in_week_scope
    from candidate_base b
  ), classified as (
    select s.*,
      (
        s.committed_in_week
        or s.hard_finish_date<=v_week_end
        or s.latest_lawful_date<=v_week_end
        or (s.work_lane in ('required','process_continuation','rhythm') and (s.due_date is null or s.due_date<=v_week_end))
        or (s.commitment_kind in ('hard_date','dependency') and s.due_date<=v_week_end)
      ) as required_this_week
    from scoped s where s.in_week_scope
  ), decorated as (
    select c.*,
      ('[]'::jsonb
       ||case when c.committed_in_week then '["committed_clock_placement"]'::jsonb else '[]'::jsonb end
       ||case when c.hard_finish_date<=v_week_end then '["hard_finish_inside_or_before_week"]'::jsonb else '[]'::jsonb end
       ||case when c.latest_lawful_date<=v_week_end then '["latest_lawful_inside_or_before_week"]'::jsonb else '[]'::jsonb end
       ||case when c.work_lane='required' and (c.due_date is null or c.due_date<=v_week_end) then '["required_lane"]'::jsonb else '[]'::jsonb end
       ||case when c.work_lane='process_continuation' and (c.due_date is null or c.due_date<=v_week_end) then '["process_continuation"]'::jsonb else '[]'::jsonb end
       ||case when c.work_lane='rhythm' and (c.due_date is null or c.due_date<=v_week_end) then '["rhythm_continuity"]'::jsonb else '[]'::jsonb end
       ||case when c.commitment_kind='hard_date' and c.due_date<=v_week_end then '["operational_hard_date"]'::jsonb else '[]'::jsonb end
       ||case when c.commitment_kind='dependency' and c.due_date<=v_week_end then '["dependency_continuation"]'::jsonb else '[]'::jsonb end
      ) as reason_codes
    from classified c
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'taskId',d.task_id,'title',d.title,'status',d.status,'dueDate',d.due_date,
      'workLane',d.work_lane,'commitmentKind',d.commitment_kind,'priorityLabel',d.priority,
      'requiredThisWeek',d.required_this_week,'reasonCodes',d.reason_codes,
      'expectedActiveMinutes',d.expected_active_minutes,'durationState',case when d.expected_active_minutes>0 then 'estimated' else 'unestimated' end,
      'physicalLoad',d.physical_load,'effectiveObligationClass',d.effective_obligation_class,
      'prerequisitesReady',d.prerequisites_ready,'resourcesReady',d.resources_ready,
      'plannedOccurrenceId',d.planned_occurrence_id,'sourceKind',d.source_kind,'sourceId',d.source_id,
      'occurrenceTargetDate',d.occurrence_target_date,'earliestLawfulDate',d.earliest_lawful_date,
      'preferredStartDate',d.preferred_start_date,'preferredEndDate',d.preferred_end_date,
      'latestLawfulDate',d.latest_lawful_date,'hardFinishDate',d.hard_finish_date,
      'missConsequence',coalesce(d.miss_consequence,'{}'::jsonb),'temporalContractSource',d.temporal_contract_source,
      'temporalAuthority',case
        when d.earliest_lawful_date is not null or d.latest_lawful_date is not null or d.hard_finish_date is not null then 'canonical_lawful_window'
        when d.preferred_start_date is not null or d.preferred_end_date is not null then 'canonical_preferred_window'
        when d.due_date is not null then 'task_target_only'
        else 'unknown'
      end,
      'committedInWeek',d.committed_in_week
    ) order by d.required_this_week desc,d.hard_finish_date nulls last,d.latest_lawful_date nulls last,d.due_date nulls last,d.title,d.task_id),'[]'::jsonb),
    coalesce(sum(d.expected_active_minutes) filter(where d.required_this_week and d.expected_active_minutes>0),0)::integer,
    count(*) filter(where d.required_this_week and d.expected_active_minutes<=0)::integer,
    count(*) filter(where d.required_this_week)::integer,
    count(*) filter(where d.required_this_week and (d.status='blocked' or not d.prerequisites_ready or not d.resources_ready))::integer,
    coalesce(sum(d.expected_active_minutes) filter(where not d.required_this_week and d.expected_active_minutes>0),0)::integer,
    count(*) filter(where not d.required_this_week)::integer
  into v_work,v_required_minutes,v_required_unestimated,v_required_count,v_required_readiness_risks,v_optional_minutes,v_optional_count
  from decorated d;

  v_missing_minutes:=greatest(v_required_minutes-v_planned_capacity,0);
  v_state:=case
    when v_policy_conflict_days>0 then 'capacity_policy_conflict'
    when v_anchor_days>0 then 'capacity_anchor_required'
    when v_required_unestimated>0 then 'work_estimate_required'
    when v_required_readiness_risks>0 then 'readiness_risk'
    when v_missing_minutes>0 and v_required_minutes<=v_planned_capacity+v_recovery_capacity then 'recovery_required'
    when v_missing_minutes>0 then 'capacity_conflict'
    else 'feasible'
  end;

  return jsonb_build_object(
    'contractVersion','worker_weekly_farm_contract_v1',
    'farmId',p_farm_id,'farmName',v_farm_name,'membershipId',p_membership_id,'workerKey',v_worker_key,
    'weekStart',v_week_start,'weekEnd',v_week_end,
    'state',v_state,
    'weeklyFeasibilityKnown',v_state in ('feasible','readiness_risk','recovery_required','capacity_conflict'),
    'capacityUsesOwnerAuthoredDayShapeOnly',true,
    'dailyCapacity',v_days,
    'plannedCapacityMinutes',case when v_anchor_days=0 and v_policy_conflict_days=0 then v_planned_capacity else null end,
    'recoveryCapacityMinutes',case when v_anchor_days=0 and v_policy_conflict_days=0 then v_recovery_capacity else null end,
    'capacityAnchorRequiredDays',v_anchor_days,'capacityPolicyConflictDays',v_policy_conflict_days,
    'requiredWorkCount',v_required_count,'requiredEstimatedMinutes',v_required_minutes,
    'requiredUnestimatedCount',v_required_unestimated,'requiredReadinessRiskCount',v_required_readiness_risks,
    'optionalCandidateCount',v_optional_count,'optionalCandidateEstimatedMinutes',v_optional_minutes,
    'missingPlannedCapacityMinutes',case when v_anchor_days=0 and v_policy_conflict_days=0 and v_required_unestimated=0 then v_missing_minutes else null end,
    'recoveryWouldCoverKnownShortfall',case when v_anchor_days=0 and v_policy_conflict_days=0 and v_required_unestimated=0 then v_required_minutes<=v_planned_capacity+v_recovery_capacity else null end,
    'work',v_work
  );
end;
$$;

comment on function atlas.worker_weekly_farm_contract_v1(uuid,uuid,date) is
  'Read-only Weekly Farm Contract. Gathers current released worker obligations/carryover and compares known required labor against Owner-authored normal weekly capacity before day assignment. Does not mutate tasks, obligations, placements, or production truth.';

create or replace function atlas.owner_weekly_farm_contract_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  return atlas.worker_weekly_farm_contract_v1(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

create or replace function atlas.worker_self_weekly_farm_contract_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id
      and fm.user_id=auth.uid() and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'The Weekly Farm Contract may only be read by that active Farm Hand.' using errcode='42501';
  end if;
  return atlas.worker_weekly_farm_contract_v1(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

revoke all on function atlas.worker_week_day_capacity_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_week_day_capacity_v1(uuid,uuid,date) to service_role;
revoke all on function atlas.worker_weekly_farm_contract_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_weekly_farm_contract_v1(uuid,uuid,date) to service_role;
revoke all on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) from public,anon;
grant execute on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated,service_role;
revoke all on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) from public,anon;
grant execute on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
) values
(
  'atlas.owner_weekly_farm_contract_api_v1(uuid, uuid, date)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Read the Worker Day Weekly Farm Contract before day assignment.',
    'boundary','Owner can read only for an active Farm Hand on a farm they own. Read-only; no placement or production mutation.',
    'capacity','Normal planned capacity requires Owner-authored Day Shape. Weekend capacity remains recovery/explicit override.'
  ),now()
),
(
  'atlas.worker_self_weekly_farm_contract_api_v1(uuid, uuid, date)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Allow the active Farm Hand to read their own Weekly Farm Contract.',
    'boundary','Self-only Farm Hand read. Read-only; no placement or production mutation.',
    'capacity','Normal planned capacity requires Owner-authored Day Shape. Weekend capacity remains recovery/explicit override.'
  ),now()
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  reviewed_at=now();
