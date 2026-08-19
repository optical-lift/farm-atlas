create or replace function atlas.operation_result_continuity_audit_v1(
  p_farm_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_as_of date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_projection_items jsonb:='[]'::jsonb;
  v_consumed_without_state_items jsonb:='[]'::jsonb;
  v_no_continuation_items jsonb:='[]'::jsonb;
  v_future_unready_uncovered_items jsonb:='[]'::jsonb;
  v_future_unready_governed_items jsonb:='[]'::jsonb;
  v_inventory_witness_items jsonb:='[]'::jsonb;
  v_duplicate_release_items jsonb:='[]'::jsonb;
  v_affinity_dependency_items jsonb:='[]'::jsonb;
  v_projection_count integer:=0;
  v_consumed_without_state_count integer:=0;
  v_no_continuation_count integer:=0;
  v_future_unready_uncovered_count integer:=0;
  v_future_unready_governed_count integer:=0;
  v_inventory_witness_count integer:=0;
  v_duplicate_release_count integer:=0;
  v_affinity_dependency_count integer:=0;
  v_high integer:=0;
  v_medium integer:=0;
  v_context integer:=0;
  v_state text;
begin
  if not exists(select 1 from atlas.farms where id=p_farm_id) then
    raise exception 'Farm not found.' using errcode='P0002';
  end if;

  with latest_resource_event as (
    select distinct on (e.resource_id)
      e.resource_id,e.id as event_id,e.source_task_id,e.source_kind,e.event_kind,e.observed_at,e.created_at
    from atlas.resource_events e
    where e.farm_id=p_farm_id
      and (e.observed_at at time zone 'America/Chicago')::date<=v_as_of
    order by e.resource_id,e.observed_at desc,e.created_at desc,e.id desc
  ), resource_lag as (
    select jsonb_strip_nulls(jsonb_build_object(
      'subjectKind','resource',
      'resourceId',r.id,
      'resourceKey',r.stable_key,
      'resourceLabel',r.label,
      'latestEventId',e.event_id,
      'latestEventKind',e.event_kind,
      'sourceTaskId',e.source_task_id,
      'latestObservedAt',e.observed_at,
      'stateLastEventId',s.last_event_id,
      'stateLastObservedAt',s.last_observed_at,
      'reason',case when s.resource_id is null
        then 'A persisted resource event exists but no canonical resource operational state exists.'
        else 'The canonical resource operational state does not identify the latest persisted resource event.' end
    )) item
    from latest_resource_event e
    join atlas.resources r on r.id=e.resource_id
    left join atlas.resource_operational_state s on s.resource_id=e.resource_id
    where s.resource_id is null or s.last_event_id is distinct from e.event_id
  ), latest_seed_event as (
    select distinct on (e.seed_lot_id)
      e.seed_lot_id,e.id as event_id,e.task_id,e.outcome,e.source,e.observed_at,e.created_at
    from atlas.seed_inventory_events e
    where e.farm_id=p_farm_id
      and (e.observed_at at time zone 'America/Chicago')::date<=v_as_of
    order by e.seed_lot_id,e.observed_at desc,e.created_at desc,e.id desc
  ), seed_lag as (
    select jsonb_strip_nulls(jsonb_build_object(
      'subjectKind','seed_lot',
      'seedLotId',sl.id,
      'seedLotKey',sl.stable_key,
      'seedLotLabel',sl.lot_label,
      'latestEventId',e.event_id,
      'latestOutcome',e.outcome,
      'source',e.source,
      'sourceTaskId',e.task_id,
      'latestObservedAt',e.observed_at,
      'stateSourceEventId',s.source_event_id,
      'stateLastObservedAt',s.last_observed_at,
      'reason',case when s.seed_lot_id is null
        then 'A persisted seed inventory result exists but no canonical seed inventory state exists.'
        else 'Canonical seed inventory state is not projected from the latest seed inventory result.' end
    )) item
    from latest_seed_event e
    join atlas.seed_lots sl on sl.id=e.seed_lot_id
    left join atlas.seed_inventory_state s on s.seed_lot_id=e.seed_lot_id
    where s.seed_lot_id is null or s.source_event_id is distinct from e.event_id
  ), workflow_reconciling as (
    select jsonb_strip_nulls(jsonb_build_object(
      'subjectKind','workflow_event',
      'workflowEventId',w.id,
      'eventKey',w.event_key,
      'sourceKind',w.source_kind,
      'sourceId',w.source_id,
      'sourceEvent',w.source_event,
      'eventDate',w.event_date,
      'payload',w.payload,
      'reason','Workflow event explicitly reports an unapplied, pending, or reconciling operation effect.'
    )) item
    from atlas.workflow_events w
    where w.farm_id=p_farm_id
      and w.event_date<=v_as_of
      and lower(coalesce(
        w.payload->>'effectState',
        w.payload->>'effect_state',
        w.payload->>'reconciliationState',
        w.payload->>'reconciliation_state',
        ''
      )) in ('unapplied','pending','reconciling','reconciliation_required')
  ), all_projection as (
    select item from resource_lag
    union all select item from seed_lag
    union all select item from workflow_reconciling
  )
  select count(*)::integer,coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_projection_count,v_projection_items
  from all_projection;

  with missing_state as (
    select jsonb_strip_nulls(jsonb_build_object(
      'resourceId',r.id,
      'resourceKey',r.stable_key,
      'resourceLabel',r.label,
      'eventId',e.id,
      'eventKind',e.event_kind,
      'sourceTaskId',e.source_task_id,
      'observedAt',e.observed_at,
      'reason','A consumption/depletion event exists but no resulting resource operational state exists.'
    )) item
    from atlas.resource_events e
    join atlas.resources r on r.id=e.resource_id
    left join atlas.resource_operational_state s on s.resource_id=e.resource_id
    where e.farm_id=p_farm_id
      and (e.observed_at at time zone 'America/Chicago')::date<=v_as_of
      and e.event_kind in ('consumed','charge_consumed','depleted','used','damaged','discarded')
      and s.resource_id is null
  )
  select count(*)::integer,coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_consumed_without_state_count,v_consumed_without_state_items
  from missing_state;

  with resource_action_state as (
    select r.id,r.stable_key,r.label,
           atlas.state_consequence_snapshot_v1('resource',r.id) snapshot,
           atlas.current_state_consequences_v1('resource',r.id) consequences
    from atlas.resources r
    left join atlas.resource_operational_state s on s.resource_id=r.id
    where r.farm_id=p_farm_id
      and (
        r.status='needs_repair'
        or (
          coalesce(r.metadata->>'quantity_governed','false')='true'
          and (atlas.resource_inventory_position_v1(r.id)->>'state') in ('count_required','requirement_quantity_required','restock_required')
        )
        or (
          coalesce(r.metadata->>'resource_role','')='reusable_energy_set'
          and coalesce(s.readiness_state,'unknown') in ('unknown','needs_charge','charging','unavailable')
        )
      )
  ), seed_action_state as (
    select sl.id,sl.stable_key,sl.lot_label,
           atlas.state_consequence_snapshot_v1('seed_lot',sl.id) snapshot,
           atlas.current_state_consequences_v1('seed_lot',sl.id) consequences
    from atlas.seed_lots sl
    where sl.farm_id=p_farm_id
  ), flower_action_state as (
    select b.id,b.batch_key,
           atlas.state_consequence_snapshot_v1('flower_harvest_batch',b.id) snapshot,
           atlas.current_state_consequences_v1('flower_harvest_batch',b.id) consequences
    from atlas.flower_harvest_batches b
    where b.farm_id=p_farm_id and b.harvest_date<=v_as_of
  ), uncovered as (
    select jsonb_build_object(
      'subjectKind','resource','subjectId',id,'stableKey',stable_key,'label',label,
      'state',snapshot,'reason','Action-required resource state has no open state-derived continuation.'
    ) item
    from resource_action_state
    where jsonb_array_length(consequences)=0
    union all
    select jsonb_build_object(
      'subjectKind','seed_lot','subjectId',id,'stableKey',stable_key,'label',lot_label,
      'state',snapshot,'reason','Seed state requires a count or shortfall response but has no open state-derived continuation.'
    )
    from seed_action_state
    where coalesce((snapshot->>'hasFutureCommitments')::boolean,false)
      and (
        not coalesce((snapshot->>'countTrusted')::boolean,false)
        or coalesce((snapshot->>'hasTrustedShortfall')::boolean,false)
      )
      and jsonb_array_length(consequences)=0
    union all
    select jsonb_build_object(
      'subjectKind','flower_harvest_batch','subjectId',id,'stableKey',batch_key,'label',batch_key,
      'state',snapshot,'reason','Observed harvest output is unprepared but no lawful preparation continuation is open.'
    )
    from flower_action_state
    where coalesce((snapshot->>'physicalOutputObserved')::boolean,false)
      and snapshot->>'preparationState'='unprepared'
      and jsonb_array_length(consequences)=0
  )
  select count(*)::integer,coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_no_continuation_count,v_no_continuation_items
  from uncovered;

  with open_tasks as (
    select t.id,t.title,t.status,t.due_date,t.metadata
    from atlas.tasks t
    where t.farm_id=p_farm_id
      and t.status in ('open','blocked')
      and coalesce(t.visibility_scope,'')<>'system_internal'
  ), packet_rows as (
    select
      t.id as task_id,t.title,t.status,t.due_date,
      p.value as requirement,
      coalesce((p.value->>'requirementReady')::boolean,false) as requirement_ready,
      coalesce(p.value->>'requirementRole','required') as requirement_role,
      coalesce(p.value->'stateConsequences','[]'::jsonb) as consequences
    from open_tasks t
    cross join lateral jsonb_array_elements(atlas.task_resource_requirement_packet_v1(t.id)) p(value)
    where coalesce(p.value->>'requirementRole','required')='required'
      and not coalesce((p.value->>'requirementReady')::boolean,false)
  ), missing_metadata_resource as (
    select
      t.id as task_id,t.title,t.status,t.due_date,
      jsonb_build_object(
        'resourceKey',wanted.stable_key,
        'requirementRole','required',
        'requirementSource','task_metadata',
        'requirementReady',false,
        'missingResourceIdentity',true
      ) as requirement,
      false as requirement_ready,
      'required'::text as requirement_role,
      '[]'::jsonb as consequences
    from open_tasks t
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(t.metadata->'required_resource_keys','[]'::jsonb))='array'
          then coalesce(t.metadata->'required_resource_keys','[]'::jsonb)
        else '[]'::jsonb
      end
    ) wanted(stable_key)
    left join atlas.resources r on r.farm_id=p_farm_id and r.stable_key=wanted.stable_key
    where r.id is null
  ), all_unready as (
    select * from packet_rows
    union all select * from missing_metadata_resource
  ), uncovered as (
    select jsonb_strip_nulls(jsonb_build_object(
      'taskId',task_id,'title',title,'status',status,'dueDate',due_date,
      'requirement',requirement,
      'reason','Future/open operation relies on a required resource that is unknown, missing, or unready and has no state-derived resolution consequence.'
    )) item
    from all_unready
    where jsonb_array_length(consequences)=0
  ), governed as (
    select jsonb_strip_nulls(jsonb_build_object(
      'taskId',task_id,'title',title,'status',status,'dueDate',due_date,
      'requirement',requirement,'stateConsequences',consequences,
      'reason','Future/open operation is correctly held by required-resource state and has a lawful resolution consequence.'
    )) item
    from all_unready
    where jsonb_array_length(consequences)>0
  )
  select
    (select count(*)::integer from uncovered),
    (select coalesce(jsonb_agg(item),'[]'::jsonb) from uncovered),
    (select count(*)::integer from governed),
    (select coalesce(jsonb_agg(item),'[]'::jsonb) from governed)
  into v_future_unready_uncovered_count,v_future_unready_uncovered_items,
       v_future_unready_governed_count,v_future_unready_governed_items;

  with unwitnessed as (
    select jsonb_strip_nulls(jsonb_build_object(
      'resourceId',r.id,
      'resourceKey',r.stable_key,
      'resourceLabel',r.label,
      'knownQuantity',s.known_quantity,
      'unit',coalesce(s.unit,r.unit),
      'lastEventId',s.last_event_id,
      'lastObservedAt',s.last_observed_at,
      'reason','Generic inventory claims a known quantity without an attributable absolute quantity witness in the resource event ledger.'
    )) item
    from atlas.resources r
    join atlas.resource_operational_state s on s.resource_id=r.id
    where r.farm_id=p_farm_id
      and coalesce(r.metadata->>'quantity_governed','false')='true'
      and s.quantity_state='known'
      and s.known_quantity is not null
      and (
        s.last_event_id is null
        or not exists(
          select 1
          from atlas.resource_events e
          where e.resource_id=r.id
            and e.observed_quantity is not null
            and e.observed_at<=coalesce(s.last_observed_at,now())
        )
      )
  )
  select count(*)::integer,coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_inventory_witness_count,v_inventory_witness_items
  from unwitnessed;

  with dup as (
    select i.id as instance_id,p.stable_key as policy_key,i.subject_kind,i.subject_id,e.release_generation,
           count(*)::integer as release_count,
           min(e.created_at) as first_released_at,max(e.created_at) as last_released_at
    from atlas.state_consequence_events e
    join atlas.state_consequence_instances i on i.id=e.instance_id
    join atlas.state_consequence_policies p on p.id=i.policy_id
    where e.farm_id=p_farm_id and e.event_kind='released'
    group by i.id,p.stable_key,i.subject_kind,i.subject_id,e.release_generation
    having count(*)>1
  )
  select count(*)::integer,coalesce(jsonb_agg(jsonb_build_object(
    'instanceId',instance_id,'policyKey',policy_key,'subjectKind',subject_kind,'subjectId',subject_id,
    'releaseGeneration',release_generation,'releaseCount',release_count,
    'firstReleasedAt',first_released_at,'lastReleasedAt',last_released_at,
    'reason','The same consequence generation was released more than once.'
  )),'[]'::jsonb)
  into v_duplicate_release_count,v_duplicate_release_items
  from dup;

  with prereq_affinity as (
    select jsonb_strip_nulls(jsonb_build_object(
      'source','task_prerequisites',
      'edgeId',p.id,
      'downstreamTaskId',p.downstream_task_id,
      'downstreamTitle',d.title,
      'prerequisiteTaskId',p.prerequisite_task_id,
      'prerequisiteTitle',pre.title,
      'holdMode',p.hold_mode,
      'metadata',p.metadata,
      'reason','A relationship explicitly marked as scheduling affinity is stored as a prerequisite dependency.'
    )) item
    from atlas.task_prerequisites p
    join atlas.tasks d on d.id=p.downstream_task_id
    join atlas.tasks pre on pre.id=p.prerequisite_task_id
    where p.farm_id=p_farm_id and p.active
      and (
        lower(coalesce(p.metadata->>'relationship_kind','')) in ('scheduling_affinity','same_day_affinity','bundle_affinity')
        or lower(coalesce(p.metadata->>'dependency_kind','')) in ('scheduling_affinity','same_day_affinity','bundle_affinity')
        or lower(coalesce(p.metadata->>'edge_kind','')) in ('scheduling_affinity','same_day_affinity','bundle_affinity')
        or lower(coalesce(p.metadata->>'affinity_only','false')) in ('true','yes','1')
        or p.metadata::text ilike '%scheduling_affinity%'
        or p.metadata::text ilike '%same_day_affinity%'
      )
  ), handoff_affinity_dependency as (
    select jsonb_strip_nulls(jsonb_build_object(
      'source','workflow_handoffs',
      'handoffId',h.id,
      'stableKey',h.stable_key,
      'handoffMode',h.handoff_mode,
      'effect',h.effect,
      'sourceKey',h.source_key,
      'targetTaskId',h.target_task_id,
      'metadata',h.metadata,
      'reason','A handoff marked as scheduling affinity uses a dependency-style blocking/unlock effect instead of presentation affinity.'
    )) item
    from atlas.workflow_handoffs h
    where h.farm_id=p_farm_id and h.active
      and lower(coalesce(h.handoff_mode,'')) in ('scheduling_affinity','same_day_affinity','bundle_affinity')
      and lower(coalesce(h.effect,'')) not in ('suggest_same_day','prefer_same_day','presentation_affinity','none')
  ), all_affinity as (
    select item from prereq_affinity
    union all select item from handoff_affinity_dependency
  )
  select count(*)::integer,coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_affinity_dependency_count,v_affinity_dependency_items
  from all_affinity;

  v_high:=v_projection_count
        +v_consumed_without_state_count
        +v_no_continuation_count
        +v_future_unready_uncovered_count
        +v_inventory_witness_count
        +v_duplicate_release_count;
  v_medium:=v_affinity_dependency_count;
  v_context:=v_future_unready_governed_count;
  v_state:=case
    when v_high>0 then 'operation_result_continuity_attention'
    when v_medium>0 then 'operation_result_modeling_attention'
    else 'operation_result_continuity_sound'
  end;

  return jsonb_build_object(
    'contractVersion','operation_result_continuity_audit_v1',
    'farmId',p_farm_id,
    'asOfDate',v_as_of,
    'state',v_state,
    'summary',jsonb_build_object(
      'highPriorityIssueCount',v_high,
      'mediumPriorityIssueCount',v_medium,
      'governedContextCount',v_context,
      'operationEffectProjectionLagCount',v_projection_count,
      'consumedResourceWithoutStateCount',v_consumed_without_state_count,
      'resultingStateWithoutContinuationCount',v_no_continuation_count,
      'futureOperationUnreadyResourceUncoveredCount',v_future_unready_uncovered_count,
      'futureOperationUnreadyResourceGovernedCount',v_future_unready_governed_count,
      'genericInventoryWithoutWitnessCount',v_inventory_witness_count,
      'duplicateConsequenceReleaseCount',v_duplicate_release_count,
      'schedulingAffinityAsDependencyCount',v_affinity_dependency_count
    ),
    'issueFamilies',jsonb_build_array(
      jsonb_build_object('key','or8_operation_effect_projection_lag','severity','high','count',v_projection_count,'items',v_projection_items),
      jsonb_build_object('key','or8_consumed_resource_without_state','severity','high','count',v_consumed_without_state_count,'items',v_consumed_without_state_items),
      jsonb_build_object('key','or8_resulting_state_without_continuation','severity','high','count',v_no_continuation_count,'items',v_no_continuation_items),
      jsonb_build_object('key','or8_future_operation_unready_resource_uncovered','severity','high','count',v_future_unready_uncovered_count,'items',v_future_unready_uncovered_items),
      jsonb_build_object('key','or8_future_operation_unready_resource_governed','severity','context','count',v_future_unready_governed_count,'items',v_future_unready_governed_items),
      jsonb_build_object('key','or8_generic_inventory_without_trustworthy_witness','severity','high','count',v_inventory_witness_count,'items',v_inventory_witness_items),
      jsonb_build_object('key','or8_duplicate_consequence_release','severity','high','count',v_duplicate_release_count,'items',v_duplicate_release_items),
      jsonb_build_object('key','or8_scheduling_affinity_as_dependency','severity','medium','count',v_affinity_dependency_count,'items',v_affinity_dependency_items)
    ),
    'auditCoverage',jsonb_build_object(
      'completedOperationEffectProjection','latest resource and seed inventory events compared with canonical projected state; explicit reconciling workflow payloads included',
      'consumedResourceState','consumption/depletion resource events require resource operational state',
      'resultingStateContinuation','resource, seed, and harvest action-required states require an open state-derived consequence',
      'futureResourceGate','open/blocked tasks audited through canonical resource requirement packet including metadata resource keys',
      'genericInventoryWitness','known generic inventory requires an attributable absolute quantity witness',
      'consequenceIdempotency','release events audited per consequence instance and release generation',
      'affinityVsDependency','explicit affinity markers may not be stored as prerequisite or dependency-style handoff'
    ),
    'truthBoundary',jsonb_build_object(
      'knownBlockedWorkIsNotContinuityFailureWhenResolutionConsequenceExists',true,
      'unknownInventoryIsNotZero',true,
      'auditDoesNotFabricateMissingQuantity',true,
      'schedulingAffinityIsNotPrerequisite',true,
      'domainStateRemainsCanonical',true
    ),
    'principalEscalationCreated',false
  );
end;
$$;

revoke all on function atlas.operation_result_continuity_audit_v1(uuid,date) from public, anon, authenticated;
grant execute on function atlas.operation_result_continuity_audit_v1(uuid,date) to service_role;

create or replace function atlas.farm_continuity_audit_v5(p_farm_id uuid,p_as_of_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_base jsonb;
  v_or8 jsonb;
  v_base_high integer:=0;
  v_base_medium integer:=0;
  v_or8_high integer:=0;
  v_or8_medium integer:=0;
  v_state text;
begin
  v_base:=atlas.farm_continuity_audit_v4(p_farm_id,p_as_of_date);
  v_or8:=atlas.operation_result_continuity_audit_v1(p_farm_id,p_as_of_date);
  v_base_high:=coalesce((v_base#>>'{summary,highPriorityIssueCount}')::integer,0);
  v_base_medium:=coalesce((v_base#>>'{summary,mediumPriorityIssueCount}')::integer,0);
  v_or8_high:=coalesce((v_or8#>>'{summary,highPriorityIssueCount}')::integer,0);
  v_or8_medium:=coalesce((v_or8#>>'{summary,mediumPriorityIssueCount}')::integer,0);

  v_state:=case
    when v_base_high>0 or v_or8_high>0 then 'high_priority_continuity_attention'
    when v_base_medium>0 or v_or8_medium>0 then 'continuity_attention'
    else 'no_actionable_continuity_gap_detected'
  end;

  return v_base || jsonb_build_object(
    'contractVersion','farm_continuity_audit_v5',
    'state',v_state,
    'summary',(v_base->'summary') || jsonb_build_object(
      'operationResultHighPriorityIssueCount',v_or8_high,
      'operationResultMediumPriorityIssueCount',v_or8_medium,
      'operationResultGovernedContextCount',coalesce((v_or8#>>'{summary,governedContextCount}')::integer,0),
      'combinedHighPriorityIssueCount',v_base_high+v_or8_high,
      'combinedMediumPriorityIssueCount',v_base_medium+v_or8_medium
    ),
    'issueFamilies',coalesce(v_base->'issueFamilies','[]'::jsonb)||coalesce(v_or8->'issueFamilies','[]'::jsonb),
    'operationResultContinuity',v_or8,
    'auditCoverage',(v_base->'auditCoverage') || jsonb_build_object(
      'operationResultStateTransition','audited_by_operation_result_continuity_audit_v1'
    ),
    'truthBoundary',(v_base->'truthBoundary') || jsonb_build_object(
      'governedBlockedResourceIsContextNotFailure',true,
      'stateDerivedContinuationRequiredForActionRequiredState',true,
      'operationResultAuditDoesNotEscalateToPrincipalByItself',true
    ),
    'principalEscalationCreated',false
  );
end;
$$;

revoke all on function atlas.farm_continuity_audit_v5(uuid,date) from public, anon, authenticated;
grant execute on function atlas.farm_continuity_audit_v5(uuid,date) to service_role;