create or replace function atlas.worker_weekly_farm_contract_v1(
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
      and lower(coalesce(t.metadata->>'personal_task','false')) not in ('true','yes','1')
      and lower(coalesce(t.metadata->>'paid_work','true')) not in ('false','no','0')
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
      coalesce((
        s.committed_in_week
        or s.hard_finish_date<=v_week_end
        or s.latest_lawful_date<=v_week_end
        or (s.work_lane in ('required','process_continuation','rhythm') and (s.due_date is null or s.due_date<=v_week_end))
        or (s.commitment_kind in ('hard_date','dependency') and s.due_date<=v_week_end)
      ),false) as required_this_week
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

revoke all on function atlas.worker_weekly_farm_contract_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.worker_weekly_farm_contract_v1(uuid,uuid,date) to service_role;