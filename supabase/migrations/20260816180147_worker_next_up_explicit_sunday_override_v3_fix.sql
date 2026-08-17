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
  v_candidate_ids uuid[]:=array[]::uuid[];
  v_candidate_count integer:=0;
  v_protected_count integer:=0;
  v_unresolved_count integer:=0;
  v_unestimated_count integer:=0;
  v_preview jsonb:='[]'::jsonb;
  v_task_id uuid;
  v_task atlas.tasks%rowtype;
  v_traits jsonb;
  v_consequence jsonb;
  v_protected jsonb;
  v_capacity_plan record;
  v_expected integer;
  v_fragmentation text;
  v_is_protected boolean;
  v_recommended integer;
  v_selected jsonb;
  v_state text;
  v_blocker text;
begin
  v_base:=atlas.worker_next_up_v2(p_farm_id,p_membership_id,v_day);

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
  where m.farm_id=p_farm_id and m.membership_id=p_membership_id and m.active=true
  order by m.updated_at desc nulls last,m.created_at desc nulls last
  limit 1;
  v_recovery_target:=greatest(coalesce(v_recovery_target,90),0);
  v_placed_minutes:=coalesce((v_base->>'placedMinutes')::integer,0);
  v_remaining:=greatest(v_recovery_target-v_placed_minutes,0);

  with candidate_base as (
    select
      t.id as task_id,t.title,t.due_date,t.work_lane,t.commitment_kind,t.priority,t.metadata,t.planned_occurrence_id,
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
      and (
        lower(coalesce(t.metadata->>'allow_sunday','false')) in ('true','yes','1')
        or lower(coalesce(t.metadata->>'sunday_owner_override','false')) in ('true','yes','1')
      )
  ), lawful as (
    select c.*
    from candidate_base c
    where coalesce((c.execution_readiness->>'ready')::boolean,false)
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
    coalesce(array_agg(r.task_id order by r.rank_order),array[]::uuid[]),
    count(*)::integer,
    count(*) filter(where r.is_protected)::integer,
    count(*) filter(where r.consequence_unresolved)::integer,
    count(*) filter(where r.expected_minutes<=0)::integer,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'rank',r.rank_order,'taskId',r.task_id,'title',r.title,'dueDate',r.due_date,
      'workLane',r.work_lane,'commitmentKind',r.commitment_kind,'placedToday',r.placed_today,
      'protectedFarmMinimum',r.is_protected,'protectedCategory',r.protected_minimum->>'category',
      'consequenceTier',r.consequence_tier,'consequenceClass',r.consequence->>'effectiveClass',
      'consequenceNeedsResolution',r.consequence_unresolved,'expectedActiveMinutes',r.expected_minutes,
      'dayWindow',r.traits->>'dayWindow','environment',r.traits->>'environment',
      'physicalLoad',(r.capacity).physical_load,'fragmentation',r.traits->>'fragmentation',
      'interruptibility',r.traits->>'interruptibility','operationClass',r.traits->>'operationClass',
      'plannedOccurrenceId',r.planned_occurrence_id,'occurrenceSourceKind',r.source_kind,
      'sundayAuthorized',true
    )) order by r.rank_order),'[]'::jsonb)
  into v_candidate_ids,v_candidate_count,v_protected_count,v_unresolved_count,v_unestimated_count,v_preview
  from ranked r;

  if v_candidate_count=0 then
    return v_base || jsonb_build_object(
      'contractVersion','worker_next_up_v3',
      'sundayExplicitOverride',false,
      'sundayAuthorizedCandidateCount',0,
      'generalSundayWorkExcluded',true
    );
  end if;

  if v_remaining<=0 then
    v_state:='capacity_conflict';
    v_blocker:='Sunday-authorized work exists, but the explicit recovery allowance is already consumed.';
  elsif v_unresolved_count>0 then
    v_state:='consequence_resolution_required';
    v_blocker:='Sunday-authorized work exists, but its consequence-of-delay is unresolved.';
  else
    foreach v_task_id in array v_candidate_ids loop
      select * into v_task from atlas.tasks where id=v_task_id;
      v_traits:=atlas.task_clock_function_traits_v2(v_task_id,v_day);
      v_consequence:=atlas.task_effective_delay_consequence_v1(v_task_id,v_day);
      v_protected:=atlas.task_protected_farm_minimum_v1(v_task_id,v_day);
      select * into v_capacity_plan from atlas.task_capacity_plan_v1(v_task,v_day);
      v_expected:=coalesce(v_capacity_plan.expected_active_minutes,0);
      v_fragmentation:=v_traits->>'fragmentation';
      v_is_protected:=coalesce((v_protected->>'protectedFarmMinimum')::boolean,false);

      if v_protected_count>0 and not v_is_protected then continue; end if;
      if v_expected<=0 then
        v_state:='work_estimate_required';
        v_blocker:='Sunday-authorized work exists but has no active-time estimate.';
        exit;
      end if;
      if v_fragmentation='should_not_fragment' and v_expected>v_remaining then continue; end if;
      v_recommended:=case when v_fragmentation='can_fragment' then least(v_expected,v_remaining) else v_expected end;
      if v_recommended<=0 then continue; end if;

      v_selected:=jsonb_strip_nulls(jsonb_build_object(
        'taskId',v_task.id,'title',v_task.title,'dueDate',v_task.due_date,'workLane',v_task.work_lane,
        'commitmentKind',v_task.commitment_kind,'expectedActiveMinutes',v_expected,
        'recommendedBlockMinutes',v_recommended,'fragmented',v_recommended<v_expected,
        'capacityClass','explicit_sunday_override','protectedFarmMinimum',v_is_protected,
        'protectedCategory',v_protected->>'category',
        'consequenceTier',case when coalesce(v_consequence->>'effectiveTier','') ~ '^[1-6]$' then (v_consequence->>'effectiveTier')::integer else null end,
        'consequenceClass',v_consequence->>'effectiveClass','operationClass',v_traits->>'operationClass',
        'traitKeys',v_traits->'traitKeys','dayWindow',v_traits->>'dayWindow','environment',v_traits->>'environment',
        'physicalLoad',v_capacity_plan.physical_load,'fragmentation',v_traits->>'fragmentation',
        'interruptibility',v_traits->>'interruptibility','executionDo',nullif(v_task.metadata->>'execution_do',''),
        'executionDoneWhen',nullif(v_task.metadata->>'execution_done_when',''),'sundayAuthorized',true
      ));
      v_state:='ready';
      exit;
    end loop;

    if v_state is null then
      v_state:='capacity_conflict';
      v_blocker:='Sunday-authorized work exists, but no candidate fits the explicit recovery allowance.';
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
    'sundayExplicitOverride',true,'sundayAuthorizedCandidateCount',v_candidate_count,
    'generalSundayWorkExcluded',true,'failClosedOnUnknownCapacity',true,
    'failClosedOnUnresolvedConsequenceOrdering',true
  );
end;
$$;

update atlas.authenticated_rpc_registry
set evidence=evidence || jsonb_build_object(
      'implementationFix','Single ranked Sunday-authorized candidate set now governs both preview and selection.'
    ),
    reviewed_at=now()
where signature='atlas.worker_next_up_v3(uuid, uuid, date)';