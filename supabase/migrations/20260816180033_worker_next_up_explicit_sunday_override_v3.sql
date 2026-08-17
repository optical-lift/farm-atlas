create or replace function atlas.worker_next_up_v3(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_day date:=coalesce(p_day,(now() at time zone 'America/Chicago')::date);
  v_base jsonb;
  v_recovery_target integer:=90;
  v_placed_minutes integer:=0;
  v_remaining integer:=0;
  v_candidate_count integer:=0;
  v_protected_count integer:=0;
  v_unresolved_count integer:=0;
  v_unestimated_count integer:=0;
  v_preview jsonb:='[]'::jsonb;
  v_selected jsonb;
  v_state text;
  v_blocker text;
begin
  v_base:=atlas.worker_next_up_v2(p_farm_id,p_membership_id,v_day);

  -- Ordinary Worker Day behavior is unchanged. Sunday is special only when
  -- the normal capacity contract has correctly closed the day.
  if extract(dow from v_day)::integer<>0
     or coalesce(v_base->>'state','')<>'worker_unavailable' then
    return v_base || jsonb_build_object(
      'contractVersion','worker_next_up_v3',
      'sundayExplicitOverride',false
    );
  end if;

  select coalesce(m.recovery_target_minutes,90)
  into v_recovery_target
  from atlas.member_capacity_settings m
  where m.farm_id=p_farm_id
    and m.membership_id=p_membership_id
    and m.active=true
  order by m.updated_at desc nulls last,m.created_at desc nulls last
  limit 1;
  v_recovery_target:=greatest(coalesce(v_recovery_target,90),0);

  v_placed_minutes:=coalesce((v_base->>'placedMinutes')::integer,0);
  v_remaining:=greatest(v_recovery_target-v_placed_minutes,0);

  with candidate_base as (
    select
      t.id as task_id,t.title,t.due_date,t.work_lane,t.commitment_kind,t.priority,t.task_type,t.metadata,t.planned_occurrence_id,
      o.state as occurrence_state,o.source_kind,o.planned_due_date,o.not_before_date,o.earliest_lawful_date,o.latest_lawful_date,o.hard_finish_date,
      atlas.task_clock_function_traits_v2(t.id,v_day) as traits,
      atlas.task_effective_delay_consequence_v1(t.id,v_day) as consequence,
      atlas.task_protected_farm_minimum_v1(t.id,v_day) as protected_minimum,
      atlas.task_execution_readiness_v1(t.id) as execution_readiness,
      atlas.task_capacity_plan_v1(t,v_day) as capacity,
      exists(
        select 1 from atlas.worker_day_task_placements p
        where p.farm_id=p_farm_id and p.membership_id=p_membership_id
          and p.service_date=v_day and p.task_id=t.id and p.state='placed'
      ) as placed_today,
      (
        lower(coalesce(t.metadata->>'allow_sunday','false')) in ('true','yes','1')
        or lower(coalesce(t.metadata->>'sunday_owner_override','false')) in ('true','yes','1')
      ) as sunday_authorized,
      (
        coalesce(t.commitment_kind,'')='hard_date'
        or lower(coalesce(t.metadata->>'date_behavior',''))='hard_date'
        or lower(coalesce(t.metadata->>'date_commitment',''))='hard_date'
        or lower(coalesce(t.metadata->>'calendar_commitment_kind',''))='owner_hard_date'
      ) as hard_date_contract
    from atlas.tasks t
    left join atlas.planned_work_occurrences o on o.id=t.planned_occurrence_id
    where t.farm_id=p_farm_id
      and t.assigned_membership_id=p_membership_id
      and t.task_scope='farm_operation'
      and t.status='open'
      and t.parent_task_id is null
      and nullif(t.metadata->>'parent_task_id','') is null
      and lower(coalesce(t.metadata->>'is_child_task','false')) not in ('true','yes','1')
      and lower(coalesce(t.metadata->>'personal_task','false')) not in ('true','yes','1')
      and lower(coalesce(t.metadata->>'paid_work','true')) not in ('false','no','0')
      and coalesce(t.visibility_scope,'')<>'system_internal'
  ), lawful as (
    select c.*
    from candidate_base c
    where c.sunday_authorized
      and coalesce((c.execution_readiness->>'ready')::boolean,false)
      and (c.planned_occurrence_id is null or c.occurrence_state='released')
      and (c.not_before_date is null or c.not_before_date<=v_day)
      and (c.earliest_lawful_date is null or c.earliest_lawful_date<=v_day)
      and (c.latest_lawful_date is null or c.latest_lawful_date>=v_day)
      and (c.hard_finish_date is null or c.hard_finish_date>=v_day)
      and not (c.hard_date_contract and c.due_date is not null and c.due_date<v_day and not c.placed_today)
      and (
        c.placed_today
        or case
          when c.due_date is not null then c.due_date<=v_day
          when c.planned_due_date is not null then c.planned_due_date<=v_day
          else c.work_lane in ('required','process_continuation','rhythm')
        end
      )
  ), ranked as (
    select l.*,
      coalesce((l.protected_minimum->>'protectedFarmMinimum')::boolean,false) as is_protected,
      coalesce((l.consequence->>'needsConsequenceResolution')::boolean,true) as consequence_unresolved,
      case when coalesce(l.consequence->>'effectiveTier','') ~ '^[1-6]$'
        then (l.consequence->>'effectiveTier')::integer else null end as consequence_tier,
      (l.capacity).expected_active_minutes as expected_minutes,
      row_number() over(order by
        case when l.placed_today then 0 else 1 end,
        case when coalesce((l.protected_minimum->>'protectedFarmMinimum')::boolean,false) then 0 else 1 end,
        case when coalesce(l.consequence->>'effectiveTier','') ~ '^[1-6]$'
          then (l.consequence->>'effectiveTier')::integer else 99 end,
        l.hard_finish_date nulls last,l.latest_lawful_date nulls last,l.due_date nulls last,
        case l.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
        l.title,l.task_id
      ) as rank_order
    from lawful l
  )
  select
    count(*)::integer,
    count(*) filter(where is_protected)::integer,
    count(*) filter(where consequence_unresolved)::integer,
    count(*) filter(where expected_minutes<=0)::integer,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'rank',rank_order,'taskId',task_id,'title',title,'dueDate',due_date,
      'workLane',work_lane,'commitmentKind',commitment_kind,'placedToday',placed_today,
      'protectedFarmMinimum',is_protected,'protectedCategory',protected_minimum->>'category',
      'consequenceTier',consequence_tier,'consequenceClass',consequence->>'effectiveClass',
      'consequenceNeedsResolution',consequence_unresolved,'expectedActiveMinutes',expected_minutes,
      'dayWindow',traits->>'dayWindow','environment',traits->>'environment',
      'physicalLoad',(capacity).physical_load,'fragmentation',traits->>'fragmentation',
      'interruptibility',traits->>'interruptibility','operationClass',traits->>'operationClass',
      'plannedOccurrenceId',planned_occurrence_id,'occurrenceSourceKind',source_kind,
      'sundayAuthorized',true
    )) order by rank_order),'[]'::jsonb)
  into v_candidate_count,v_protected_count,v_unresolved_count,v_unestimated_count,v_preview
  from ranked;

  if v_candidate_count=0 then
    return v_base || jsonb_build_object(
      'contractVersion','worker_next_up_v3',
      'sundayExplicitOverride',false,
      'sundayAuthorizedCandidateCount',0
    );
  end if;

  if v_remaining<=0 then
    v_state:='capacity_conflict';
    v_blocker:='Sunday-authorized work exists, but the explicit recovery allowance is already consumed.';
  elsif v_unresolved_count>0 then
    v_state:='consequence_resolution_required';
    v_blocker:='Sunday-authorized work exists, but its consequence-of-delay is unresolved.';
  else
    select jsonb_strip_nulls(jsonb_build_object(
      'taskId',r.task_id,'title',r.title,'dueDate',r.due_date,'workLane',r.work_lane,
      'commitmentKind',r.commitment_kind,'expectedActiveMinutes',r.expected_minutes,
      'recommendedBlockMinutes',case
        when r.traits->>'fragmentation'='can_fragment' then least(r.expected_minutes,v_remaining)
        else r.expected_minutes end,
      'fragmented',r.traits->>'fragmentation'='can_fragment' and r.expected_minutes>v_remaining,
      'capacityClass','explicit_sunday_override','protectedFarmMinimum',r.is_protected,
      'protectedCategory',r.protected_minimum->>'category','consequenceTier',r.consequence_tier,
      'consequenceClass',r.consequence->>'effectiveClass','operationClass',r.traits->>'operationClass',
      'traitKeys',r.traits->'traitKeys','dayWindow',r.traits->>'dayWindow','environment',r.traits->>'environment',
      'physicalLoad',(r.capacity).physical_load,'fragmentation',r.traits->>'fragmentation',
      'interruptibility',r.traits->>'interruptibility','executionDo',nullif(r.metadata->>'execution_do',''),
      'executionDoneWhen',nullif(r.metadata->>'execution_done_when',''),'sundayAuthorized',true
    ))
    into v_selected
    from (
      with base as (
        select
          t.id as task_id,t.title,t.due_date,t.work_lane,t.commitment_kind,t.priority,t.metadata,
          o.state as occurrence_state,o.source_kind,o.planned_due_date,o.not_before_date,o.earliest_lawful_date,o.latest_lawful_date,o.hard_finish_date,
          atlas.task_clock_function_traits_v2(t.id,v_day) as traits,
          atlas.task_effective_delay_consequence_v1(t.id,v_day) as consequence,
          atlas.task_protected_farm_minimum_v1(t.id,v_day) as protected_minimum,
          atlas.task_execution_readiness_v1(t.id) as execution_readiness,
          atlas.task_capacity_plan_v1(t,v_day) as capacity,
          exists(select 1 from atlas.worker_day_task_placements p where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.service_date=v_day and p.task_id=t.id and p.state='placed') as placed_today
        from atlas.tasks t
        left join atlas.planned_work_occurrences o on o.id=t.planned_occurrence_id
        where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id
          and t.task_scope='farm_operation' and t.status='open'
          and t.parent_task_id is null and nullif(t.metadata->>'parent_task_id','') is null
          and lower(coalesce(t.metadata->>'is_child_task','false')) not in ('true','yes','1')
          and lower(coalesce(t.metadata->>'personal_task','false')) not in ('true','yes','1')
          and lower(coalesce(t.metadata->>'paid_work','true')) not in ('false','no','0')
          and coalesce(t.visibility_scope,'')<>'system_internal'
          and (
            lower(coalesce(t.metadata->>'allow_sunday','false')) in ('true','yes','1')
            or lower(coalesce(t.metadata->>'sunday_owner_override','false')) in ('true','yes','1')
          )
      )
      select b.*,
        coalesce((b.protected_minimum->>'protectedFarmMinimum')::boolean,false) as is_protected,
        case when coalesce(b.consequence->>'effectiveTier','') ~ '^[1-6]$' then (b.consequence->>'effectiveTier')::integer else null end as consequence_tier,
        (b.capacity).expected_active_minutes as expected_minutes
      from base b
      where coalesce((b.execution_readiness->>'ready')::boolean,false)
        and (b.planned_occurrence_id is null or b.occurrence_state='released')
        and (b.not_before_date is null or b.not_before_date<=v_day)
        and (b.earliest_lawful_date is null or b.earliest_lawful_date<=v_day)
        and (b.latest_lawful_date is null or b.latest_lawful_date>=v_day)
        and (b.hard_finish_date is null or b.hard_finish_date>=v_day)
        and (b.due_date is null or b.due_date<=v_day or b.placed_today)
        and (b.capacity).expected_active_minutes>0
        and not (b.traits->>'fragmentation'='should_not_fragment' and (b.capacity).expected_active_minutes>v_remaining)
      order by
        case when b.placed_today then 0 else 1 end,
        case when coalesce((b.protected_minimum->>'protectedFarmMinimum')::boolean,false) then 0 else 1 end,
        case when coalesce(b.consequence->>'effectiveTier','') ~ '^[1-6]$' then (b.consequence->>'effectiveTier')::integer else 99 end,
        b.due_date nulls last,b.priority,b.title,b.task_id
      limit 1
    ) r;

    if v_selected is null then
      if v_unestimated_count>0 then
        v_state:='work_estimate_required';
        v_blocker:='Sunday-authorized work exists but has no active-time estimate.';
      else
        v_state:='capacity_conflict';
        v_blocker:='Sunday-authorized work exists, but no candidate fits the explicit recovery allowance.';
      end if;
    else
      v_state:='ready';
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','worker_next_up_v3',
    'farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',v_day,
    'state',v_state,'blocker',v_blocker,'nextUp',v_selected,
    'candidateCount',v_candidate_count,'protectedCandidateCount',v_protected_count,
    'unresolvedConsequenceCandidateCount',v_unresolved_count,'unestimatedCandidateCount',v_unestimated_count,
    'candidateOrderingReady',v_unresolved_count=0,'candidatePreview',v_preview,
    'readinessAttentionCount',0,'blockedProtectedReadinessCount',0,'readinessAttention','[]'::jsonb,
    'capacity',jsonb_build_object(
      'contractVersion','worker_sunday_explicit_override_capacity_v1',
      'serviceDate',v_day,'state','explicit_override','capacityKnown',true,
      'capacityClass','explicit_override','plannedCapacityMinutes',0,
      'recoveryCapacityMinutes',v_recovery_target,'placedMinutes',v_placed_minutes,
      'remainingRecoveryMinutes',v_remaining,'baseCapacity',v_base->'capacity'
    ),
    'placedMinutes',v_placed_minutes,'remainingPlannedMinutes',0,
    'remainingRecoveryInclusiveMinutes',v_remaining,
    'currentHumanTimeReservation',v_base->'currentHumanTimeReservation',
    'currentDaypart',v_base->'currentDaypart',
    'sundayExplicitOverride',true,
    'sundayAuthorizedCandidateCount',v_candidate_count,
    'failClosedOnUnknownCapacity',true,
    'failClosedOnUnresolvedConsequenceOrdering',true,
    'generalSundayWorkExcluded',true
  );
end;
$$;

revoke all on function atlas.worker_next_up_v3(uuid,uuid,date) from public;
revoke execute on function atlas.worker_next_up_v3(uuid,uuid,date) from anon,authenticated;
grant execute on function atlas.worker_next_up_v3(uuid,uuid,date) to service_role;

create or replace function atlas.worker_self_next_up_api_v1(
  p_farm_id uuid,p_membership_id uuid,p_day date default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.user_id=auth.uid() and fm.active=true and fm.role='farm_hand') then
    raise exception 'Next Up may only be read by that active Farm Hand.' using errcode='42501';
  end if;
  return atlas.worker_next_up_v3(p_farm_id,p_membership_id,p_day);
end;
$$;

create or replace function atlas.owner_worker_next_up_api_v1(
  p_farm_id uuid,p_membership_id uuid,p_day date default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner farm membership required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  return atlas.worker_next_up_v3(p_farm_id,p_membership_id,p_day);
end;
$$;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values (
  'atlas.worker_next_up_v3(uuid, uuid, date)','service_internal','verified','active',false,true,true,2,0,
  jsonb_build_object(
    'purpose','Canonical Next Up selection with explicit Sunday exception handling',
    'sundayTruth','Sunday remains zero general capacity; only explicitly authorized Sunday tasks may enter the recovery exception lane',
    'capacityTruth','Sunday exception uses configured recovery_target_minutes and never increases weekly planned capacity',
    'replacement','Public worker/owner Next Up APIs now delegate to v3'
  ),now(),now()
) on conflict(signature) do update set
  classification=excluded.classification,confidence=excluded.confidence,review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,policy_reference_count=excluded.policy_reference_count,evidence=excluded.evidence,reviewed_at=now();

update atlas.authenticated_rpc_registry
set evidence=evidence || jsonb_build_object(
      'nextUpContract','worker_next_up_v3',
      'sundayTruth','General Sunday work remains unavailable; explicit Sunday-authorized work may use the recovery exception lane.'
    ),
    reviewed_at=now()
where signature in (
  'atlas.worker_self_next_up_api_v1(uuid, uuid, date)',
  'atlas.owner_worker_next_up_api_v1(uuid, uuid, date)'
);