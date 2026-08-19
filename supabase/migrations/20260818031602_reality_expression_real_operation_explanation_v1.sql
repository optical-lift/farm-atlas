create or replace function atlas.real_operation_explanation_v1(
  p_transition_id uuid
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_transition atlas.task_transitions%rowtype;
  v_task atlas.tasks%rowtype;
  v_outcome atlas.task_outcome_events%rowtype;
  v_task_workflow atlas.workflow_events%rowtype;
  v_journal atlas.journal_event_index%rowtype;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_next jsonb := '[]'::jsonb;
  v_current_claims jsonb := '[]'::jsonb;
  v_reforecast_lots jsonb := '[]'::jsonb;
  v_subject_count integer := 0;
  v_operation_actual_count integer := 0;
  v_required_result_count integer := 0;
  v_production_lot_count integer := 0;
  v_planting_claim_count integer := 0;
  v_bell_worthy boolean := null;
  v_bell_requires_action boolean := null;
  v_bell_receipt_count integer := 0;
  v_rec record;
  v_before_event atlas.workflow_events%rowtype;
  v_after_event atlas.workflow_events%rowtype;
  v_packet jsonb;
  v_before_state text;
  v_before_lifecycle text;
  v_after_state text;
  v_after_lifecycle text;
  v_result_capture_state text;
  v_explanation_state text;
begin
  if p_transition_id is null then
    raise exception 'A task transition is required.' using errcode='22023';
  end if;

  select * into v_transition
  from atlas.task_transitions
  where id=p_transition_id;

  if v_transition.id is null then
    raise exception 'Task transition was not found.' using errcode='P0002';
  end if;

  if auth.uid() is not null and not atlas.is_farm_member(v_transition.farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks
  where id=v_transition.task_id and farm_id=v_transition.farm_id;

  if v_task.id is null then
    raise exception 'Transition task was not found on its farm.' using errcode='P0002';
  end if;

  if v_transition.task_outcome_event_id is not null then
    select * into v_outcome
    from atlas.task_outcome_events
    where id=v_transition.task_outcome_event_id;
  end if;

  select * into v_task_workflow
  from atlas.workflow_events we
  where we.source_kind='task'
    and we.source_id=v_task.id
    and (
      (v_outcome.id is not null and we.payload->>'task_outcome_event_id'=v_outcome.id::text)
      or (we.created_at=v_transition.created_at and we.source_event=v_transition.transition)
    )
  order by case when v_outcome.id is not null and we.payload->>'task_outcome_event_id'=v_outcome.id::text then 0 else 1 end,
           we.created_at,we.id
  limit 1;

  if v_task_workflow.id is not null then
    select * into v_journal
    from atlas.journal_event_index je
    where je.source_workflow_event_id=v_task_workflow.id
    order by je.created_at,je.id
    limit 1;
  end if;

  if v_journal.id is not null then
    begin
      v_bell_worthy := atlas.bell_event_is_worthy_v1(v_journal.id);
    exception when others then
      v_bell_worthy := null;
    end;

    if v_transition.actor_user_id is not null then
      begin
        v_bell_requires_action := atlas.bell_event_requires_action_v1(v_journal.id,v_transition.actor_user_id);
      exception when others then
        v_bell_requires_action := null;
      end;
    end if;

    select count(*)::integer into v_bell_receipt_count
    from atlas.bell_event_receipts ber
    where ber.journal_event_id=v_journal.id;
  end if;

  select count(*)::integer into v_operation_actual_count
  from atlas.production_operation_actuals a
  where a.task_id=v_task.id;

  if jsonb_typeof(v_task.metadata->'worker_result_lines')='array' then
    v_required_result_count := jsonb_array_length(v_task.metadata->'worker_result_lines');
  else
    v_required_result_count := 0;
  end if;

  for v_rec in
    select cc.*,go.object_key,go.label as object_label,tc.role as task_crop_role,tc.created_at as task_crop_linked_at
    from atlas.task_crop_cycles tc
    join atlas.crop_cycles cc on cc.id=tc.crop_cycle_id
    left join atlas.growing_objects go on go.id=cc.object_id
    where tc.task_id=v_task.id
    order by cc.crop_label,cc.variety,go.label,cc.id
  loop
    v_subject_count := v_subject_count+1;

    select * into v_before_event
    from atlas.workflow_events we
    where we.source_kind='crop_cycle'
      and we.source_id=v_rec.id
      and we.created_at<v_transition.created_at
    order by we.created_at desc,we.id desc
    limit 1;

    v_before_state := coalesce(v_before_event.payload->>'cycle_state','unresolved');
    v_before_lifecycle := coalesce(v_before_event.payload->>'lifecycle_status','unresolved');

    select * into v_after_event
    from atlas.workflow_events we
    where we.source_kind='crop_cycle'
      and we.source_id=v_rec.id
      and we.created_at>=v_transition.created_at
      and we.created_at<=v_transition.created_at+interval '1 second'
    order by we.created_at,we.id
    limit 1;

    v_after_state := coalesce(v_after_event.payload->>'cycle_state','unresolved');
    v_after_lifecycle := coalesce(v_after_event.payload->>'lifecycle_status','unresolved');

    v_packet := atlas.crop_cycle_reality_expression_v4(v_rec.id);

    v_before := v_before || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'subjectType','crop_cycle',
      'cropCycleId',v_rec.id,
      'cropCycleKey',v_rec.crop_cycle_key,
      'cropLabel',v_rec.crop_label,
      'variety',v_rec.variety,
      'objectId',v_rec.object_id,
      'objectKey',v_rec.object_key,
      'objectLabel',v_rec.object_label,
      'taskRelationRole',v_rec.task_crop_role,
      'taskLinkedAt',v_rec.task_crop_linked_at,
      'state',v_before_state,
      'lifecycleStatus',v_before_lifecycle,
      'evidenceAt',v_before_event.created_at,
      'sourceEvent',v_before_event.source_event,
      'reconstructionState',case when v_before_event.id is null then 'no_prior_subject_event' else 'event_reconstructed' end
    )));

    v_after := v_after || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'subjectType','crop_cycle',
      'cropCycleId',v_rec.id,
      'cropCycleKey',v_rec.crop_cycle_key,
      'cropLabel',v_rec.crop_label,
      'variety',v_rec.variety,
      'objectId',v_rec.object_id,
      'objectKey',v_rec.object_key,
      'objectLabel',v_rec.object_label,
      'stateAtOperation',v_after_state,
      'lifecycleStatusAtOperation',v_after_lifecycle,
      'operationEvidenceAt',v_after_event.created_at,
      'operationSourceEvent',v_after_event.source_event,
      'operationReconstructionState',case when v_after_event.id is null then 'no_direct_subject_event_at_transition' else 'event_reconstructed' end,
      'currentState',v_rec.cycle_state,
      'currentLifecycleStatus',v_rec.lifecycle_status,
      'currentRealityContract',v_packet->>'contractVersion',
      'currentIssues',coalesce(v_packet->'issues','[]'::jsonb),
      'currentContinuity',coalesce(v_packet->'continuity','{}'::jsonb)
    )));

    v_next := v_next || jsonb_build_array(jsonb_build_object(
      'cropCycleId',v_rec.id,
      'cropLabel',v_rec.crop_label,
      'variety',v_rec.variety,
      'objectLabel',v_rec.object_label,
      'fittingOperation',coalesce(v_packet->'fittingOperation','{}'::jsonb),
      'continuity',coalesce(v_packet->'continuity','{}'::jsonb),
      'silentNothing',coalesce((v_packet #>> '{continuity,silentNothing}')::boolean,false)
    ));

    if v_rec.planting_claim_id is not null then
      v_planting_claim_count := v_planting_claim_count+1;
    end if;

    v_current_claims := v_current_claims || jsonb_build_array(jsonb_build_object(
      'cropCycleId',v_rec.id,
      'objectLabel',v_rec.object_label,
      'plantingClaimId',v_rec.planting_claim_id,
      'plantingClaimState',coalesce(v_packet #>> '{spatialTruth,claim,state}',v_packet #>> '{flowBuffer,plantingClaim,status}','unresolved'),
      'productionLotLinkCount',coalesce((v_packet #>> '{claims,productionLotLinkCount}')::integer,0),
      'availabilityStatus',v_packet #>> '{claims,availabilityStatus}'
    ));
  end loop;

  with lots as (
    select distinct pl.id,pl.stable_key,pl.lot_label,pl.current_stage,pl.lifecycle_status
    from atlas.production_lots pl
    where exists (
      select 1 from atlas.production_lot_tasks plt
      where plt.production_lot_id=pl.id and plt.task_id=v_task.id
    )
    or exists (
      select 1
      from atlas.production_lot_crop_cycles plc
      join atlas.task_crop_cycles tc on tc.crop_cycle_id=plc.crop_cycle_id
      where plc.production_lot_id=pl.id and tc.task_id=v_task.id
    )
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'productionLotId',id,
           'stableKey',stable_key,
           'lotLabel',lot_label,
           'currentStage',current_stage,
           'lifecycleStatus',lifecycle_status,
           'preview',atlas.production_lot_reforecast_preview_v1(id,null)
         ) order by lot_label,id),'[]'::jsonb)
  into v_production_lot_count,v_reforecast_lots
  from lots;

  v_result_capture_state := case
    when v_required_result_count=0 then 'no_additional_result_evidence_required_by_task'
    when v_operation_actual_count>0 then 'structured_operation_actual_present'
    when coalesce(v_transition.note,'')<>'' or coalesce(v_transition.reason,'')<>'' then 'unstructured_transition_text_present_completeness_unproven'
    else 'required_result_evidence_not_captured'
  end;

  v_explanation_state := case
    when v_subject_count=0 then 'operation_subject_unrepresented'
    when exists(select 1 from jsonb_array_elements(v_after) x where x->>'operationReconstructionState'='event_reconstructed') then 'real_operation_reconstructed'
    else 'transition_recorded_subject_effect_unproven'
  end;

  return jsonb_build_object(
    'contractVersion','real_operation_explanation_v1',
    'state',v_explanation_state,
    'farmId',v_transition.farm_id,
    'transitionId',v_transition.id,
    'task',jsonb_build_object(
      'id',v_task.id,
      'title',v_task.title,
      'taskType',v_task.task_type,
      'actionKey',v_task.action_key,
      'operationClass',v_task.operation_class,
      'dueDate',v_task.due_date,
      'currentStatus',v_task.status
    ),
    'predictedBeforeState',jsonb_build_object(
      'state','historical_event_reconstruction',
      'subjects',v_before,
      'principle','The before state is reconstructed only from canonical subject events recorded before the human transition; current rows are not backdated into historical truth.'
    ),
    'expectedMove',jsonb_strip_nulls(jsonb_build_object(
      'actionKey',v_task.action_key,
      'operationClass',v_task.operation_class,
      'do',coalesce(nullif(v_task.metadata->>'execution_do',''),v_task.title),
      'how',v_task.metadata->'execution_how',
      'doneWhen',nullif(v_task.metadata->>'execution_done_when',''),
      'targetLabels',v_task.metadata->'target_labels',
      'requiredResultEvidence',v_task.metadata->'worker_result_lines'
    )),
    'actualEvidence',jsonb_build_object(
      'transition',jsonb_strip_nulls(jsonb_build_object(
        'id',v_transition.id,
        'transition',v_transition.transition,
        'previousStatus',v_transition.previous_status,
        'nextStatus',v_transition.next_status,
        'occurredAt',v_transition.created_at,
        'actorUserId',v_transition.actor_user_id,
        'actorMembershipId',v_transition.actor_membership_id,
        'actorRole',v_transition.actor_role,
        'note',v_transition.note,
        'reason',v_transition.reason,
        'payload',v_transition.payload
      )),
      'taskOutcomeEvent',case when v_outcome.id is null then null else jsonb_build_object(
        'id',v_outcome.id,'outcome',v_outcome.outcome,'createdAt',v_outcome.created_at,'metadata',v_outcome.metadata
      ) end,
      'structuredOperationActualCount',v_operation_actual_count,
      'resultEvidenceRequirementCount',v_required_result_count,
      'resultEvidenceCaptureState',v_result_capture_state,
      'principle','A historical Done transition proves that the transition was recorded. It does not retroactively prove missing quantities, minutes, claims, spatial geometry, or other result fields.'
    ),
    'afterState',jsonb_build_object(
      'subjects',v_after,
      'principle','State at the operation boundary comes from subject events emitted with the transition; current state is shown separately so later changes cannot be confused with the original fruit.'
    ),
    'claimMovement',jsonb_build_object(
      'state','historical_claim_movement_not_reconstructable_from_available_event_evidence',
      'movementEstablished',false,
      'currentPlantingClaimCount',v_planting_claim_count,
      'currentClaims',v_current_claims,
      'principle','The operation may have changed physical custody or spatial use, but claim movement is not asserted unless a claim-bearing evidence rail records it.'
    ),
    'reforecast',jsonb_build_object(
      'state',case when v_production_lot_count=0 then 'not_evaluable_no_production_lot_provenance' else 'current_production_reforecast_available' end,
      'productionLotCount',v_production_lot_count,
      'productionLots',v_reforecast_lots,
      'principle','A crop-cycle state change is not promoted to a Production reforecast when no Production Lot provenance connects the subject to the reforecast engine.'
    ),
    'nextOperation',jsonb_build_object(
      'subjects',v_next,
      'allSubjectsHaveContinuation',case
        when v_subject_count=0 then false
        else not exists(select 1 from jsonb_array_elements(v_next) x where coalesce((x->>'silentNothing')::boolean,false)=true)
      end,
      'principle','The operation is only institutionally complete when the changed subject has a lawful continuation, wait, gate, decision, or terminal state.'
    ),
    'visibleEffects',jsonb_build_object(
      'worker',jsonb_build_object(
        'taskStatus',v_task.status,
        'transitionRecorded',true,
        'actorMembershipId',v_transition.actor_membership_id,
        'actorRole',v_transition.actor_role
      ),
      'workflow',case when v_task_workflow.id is null then jsonb_build_object('state','no_linked_workflow_event_found') else jsonb_build_object(
        'state','recorded','eventId',v_task_workflow.id,'sourceEvent',v_task_workflow.source_event,'createdAt',v_task_workflow.created_at
      ) end,
      'journal',case when v_journal.id is null then jsonb_build_object('state','no_linked_journal_event_found') else jsonb_build_object(
        'state','recorded','eventId',v_journal.id,'eventKind',v_journal.event_kind,'title',v_journal.title,'occurredAt',v_journal.occurred_at
      ) end,
      'bell',jsonb_build_object(
        'classificationState',case when v_journal.id is null then 'not_evaluable_without_journal_event' when v_bell_worthy is true then 'bell_worthy' when v_bell_worthy is false then 'not_bell_worthy' else 'classification_unresolved' end,
        'worthy',v_bell_worthy,
        'requiresActorAction',v_bell_requires_action,
        'receiptCount',v_bell_receipt_count
      ),
      'principal',jsonb_build_object(
        'escalationCreatedByThisContract',false,
        'principle','A delegated operation and its evidence remain operational truth unless a separate explicit escalation threshold translates the consequence into Principal jurisdiction.'
      )
    ),
    'truthGaps',jsonb_build_object(
      'requiredResultEvidenceCaptureState',v_result_capture_state,
      'claimMovementEstablished',false,
      'productionReforecastEvaluable',v_production_lot_count>0,
      'currentRealityIssues',(
        select coalesce(jsonb_agg(jsonb_build_object(
          'cropCycleId',x->>'cropCycleId',
          'issues',coalesce(x->'currentIssues','[]'::jsonb)
        )),'[]'::jsonb)
        from jsonb_array_elements(v_after) x
      )
    ),
    'truthBoundary',jsonb_build_object(
      'readOnly',true,
      'historicalTransitionIsEvidenceNotCompleteFruit',true,
      'currentRowsAreNotBackdated',true,
      'missingResultFieldsAreNotInvented',true,
      'unrepresentedClaimMovementIsNotInferred',true,
      'productionReforecastRequiresProductionLotProvenance',true,
      'taskCompletionIsNotContinuationProof',true,
      'principalEscalationIsSeparateJurisdiction',true
    )
  );
end;
$function$;

revoke all on function atlas.real_operation_explanation_v1(uuid) from public;
revoke all on function atlas.real_operation_explanation_v1(uuid) from anon;
grant execute on function atlas.real_operation_explanation_v1(uuid) to authenticated;
grant execute on function atlas.real_operation_explanation_v1(uuid) to service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
) values (
  'atlas.real_operation_explanation_v1(uuid)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object(
    'purpose','Phase 8 read-only explanation of one real recorded human operation across historical before state, expected move, actual evidence, after state, claims, reforecast, continuation, Workflow, Journal, Bell, and Principal boundaries.',
    'boundary','Any active farm member may inspect a transition on that farm. Historical evidence is reconstructed without mutating or inventing missing result, claim, spatial, Production, Bell, or Principal state.',
    'architecture','This is an explanation/replay surface, not a second result writer. Genuine future worker fruit continues through domain-specific result contracts.'
  ),now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;