create or replace function atlas.worker_living_propagation_lane_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_base jsonb;
  v_items jsonb := '[]'::jsonb;
  v_attention jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_minutes integer := 0;
  v_unestimated integer := 0;
  v_attention_count integer := 0;
  v_attention_minutes integer := 0;
  v_blocked_protected integer := 0;
  v_state text;
begin
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;

  v_base := atlas.worker_living_propagation_lane_v1(p_farm_id,p_membership_id,p_day);

  with candidate_base as (
    select
      t.id as task_id,
      t.title,
      t.status,
      t.due_date,
      t.work_lane,
      t.commitment_kind,
      t.action_key,
      t.task_type,
      t.metadata,
      t.planned_occurrence_id,
      o.state as occurrence_state,
      o.source_kind,
      o.planned_due_date,
      o.not_before_date,
      o.earliest_lawful_date,
      o.latest_lawful_date,
      o.hard_finish_date,
      atlas.task_clock_function_traits_v2(t.id,p_day) as traits,
      atlas.task_execution_readiness_v1(t.id) as execution_readiness,
      atlas.task_effective_delay_consequence_v1(t.id,p_day) as consequence,
      atlas.task_protected_farm_minimum_v1(t.id,p_day) as protected_minimum,
      atlas.task_capacity_plan_v1(t,p_day) as capacity,
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
      and t.status in ('open','blocked')
      and t.parent_task_id is null
      and nullif(t.metadata->>'parent_task_id','') is null
      and lower(coalesce(t.metadata->>'is_child_task','false')) not in ('true','yes','1')
      and lower(coalesce(t.metadata->>'personal_task','false')) not in ('true','yes','1')
      and lower(coalesce(t.metadata->>'paid_work','true')) not in ('false','no','0')
      and coalesce(t.visibility_scope,'')<>'system_internal'
  ), due_lawful as (
    select c.*
    from candidate_base c
    where (c.traits->'traitKeys') ? 'propagation'
      and (c.planned_occurrence_id is null or c.occurrence_state='released')
      and (c.not_before_date is null or c.not_before_date<=p_day)
      and (c.earliest_lawful_date is null or c.earliest_lawful_date<=p_day)
      and (c.latest_lawful_date is null or c.latest_lawful_date>=p_day)
      and (c.hard_finish_date is null or c.hard_finish_date>=p_day)
      and not (c.hard_date_contract and c.due_date is not null and c.due_date<p_day)
      and case
        when c.due_date is not null then c.due_date<=p_day
        when c.planned_due_date is not null then c.planned_due_date<=p_day
        else c.work_lane in ('required','process_continuation','rhythm')
      end
  ), decorated as (
    select d.*,
      (d.status='open' and coalesce((d.execution_readiness->>'ready')::boolean,false)) as executable_now,
      coalesce((d.protected_minimum->>'protectedFarmMinimum')::boolean,false) as is_protected,
      case when coalesce(d.consequence->>'effectiveTier','') ~ '^[1-6]$'
        then (d.consequence->>'effectiveTier')::integer else null end as consequence_tier,
      (d.capacity).expected_active_minutes as expected_minutes
    from due_lawful d
  )
  select
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'taskId',d.task_id,
      'title',d.title,
      'dueDate',d.due_date,
      'workLane',d.work_lane,
      'commitmentKind',d.commitment_kind,
      'actionKey',d.action_key,
      'taskType',d.task_type,
      'environment',d.traits->>'environment',
      'propagationTransition',d.traits->>'propagationTransition',
      'dayWindow',d.traits->>'dayWindow',
      'interruptibility',d.traits->>'interruptibility',
      'fragmentation',d.traits->>'fragmentation',
      'expectedActiveMinutes',d.expected_minutes,
      'physicalLoad',(d.capacity).physical_load,
      'consequenceTier',d.consequence_tier,
      'consequenceClass',d.consequence->>'effectiveClass',
      'protectedFarmMinimum',d.is_protected,
      'protectedCategory',d.protected_minimum->>'category',
      'executionReadiness',d.execution_readiness,
      'cropLabel',coalesce(nullif(d.metadata->>'crop_label',''),nullif(d.metadata->>'crop','')),
      'variety',nullif(d.metadata->>'variety',''),
      'executionDo',nullif(d.metadata->>'execution_do',''),
      'executionDoneWhen',nullif(d.metadata->>'execution_done_when',''),
      'plannedOccurrenceId',d.planned_occurrence_id,
      'occurrenceSourceKind',d.source_kind,
      'occurrenceTargetDate',d.planned_due_date
    )) order by
      d.is_protected desc,
      d.consequence_tier nulls last,
      d.due_date nulls last,
      d.title,
      d.task_id) filter(where d.executable_now), '[]'::jsonb),
    count(*) filter(where d.executable_now)::integer,
    coalesce(sum(d.expected_minutes) filter(where d.executable_now and d.expected_minutes>0),0)::integer,
    count(*) filter(where d.executable_now and d.expected_minutes<=0)::integer,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'taskId',d.task_id,
      'title',d.title,
      'status',d.status,
      'dueDate',d.due_date,
      'workLane',d.work_lane,
      'commitmentKind',d.commitment_kind,
      'actionKey',d.action_key,
      'taskType',d.task_type,
      'environment',d.traits->>'environment',
      'propagationTransition',d.traits->>'propagationTransition',
      'dayWindow',d.traits->>'dayWindow',
      'expectedActiveMinutes',d.expected_minutes,
      'protectedFarmMinimum',d.is_protected,
      'protectedCategory',d.protected_minimum->>'category',
      'executionReadiness',d.execution_readiness,
      'attentionReason',case when d.status='blocked' then 'task_status_blocked' else 'execution_readiness_unresolved' end
    )) order by
      d.is_protected desc,
      d.due_date nulls last,
      d.title,
      d.task_id) filter(where not d.executable_now), '[]'::jsonb),
    count(*) filter(where not d.executable_now)::integer,
    coalesce(sum(greatest(d.expected_minutes,0)) filter(where not d.executable_now),0)::integer,
    count(*) filter(where not d.executable_now and d.is_protected)::integer
  into
    v_items,
    v_count,
    v_minutes,
    v_unestimated,
    v_attention,
    v_attention_count,
    v_attention_minutes,
    v_blocked_protected
  from decorated d;

  v_state := case
    when v_count>0 and v_attention_count>0 then 'intervention_and_readiness_resolution_required'
    when v_count>0 then 'intervention_required'
    when v_attention_count>0 then 'readiness_resolution_required'
    when nullif(v_base->>'completedGrowRoomRoundTaskId','') is not null
      and coalesce((v_base->>'completedGrowRoomRoundRequestCount')::integer,0)=0
      then 'inspected_no_additional_intervention'
    when coalesce((v_base->>'activeGrowRoomCycleCount')::integer,0)>0
      or coalesce((v_base->>'activeProductionTrayBatchCount')::integer,0)>0
      then 'inspection_required_for_closure'
    else 'no_living_propagation_inventory'
  end;

  return v_base || jsonb_build_object(
    'contractVersion','worker_living_propagation_lane_v2',
    'state',v_state,
    'interventionCount',v_count,
    'estimatedInterventionMinutes',v_minutes,
    'unestimatedInterventionCount',v_unestimated,
    'items',v_items,
    'readinessAttentionCount',v_attention_count,
    'readinessAttentionEstimatedMinutes',v_attention_minutes,
    'blockedProtectedReadinessCount',v_blocked_protected,
    'readinessAttention',v_attention,
    'clockFunctionalTaxonomyVersion','task_clock_function_traits_v2',
    'executionReadinessContractVersion','task_execution_readiness_v1',
    'finalTransplantRequiresResolvedDestination',true
  );
end;
$$;

revoke all on function atlas.worker_living_propagation_lane_v2(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.worker_living_propagation_lane_v2(uuid,uuid,date) to service_role;