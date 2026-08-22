create or replace function atlas.worker_state_transition_followup_crop_bridge_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date,
  p_card jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_card jsonb := coalesce(p_card,'{}'::jsonb);
  v_task atlas.tasks%rowtype;
  v_cycle_id uuid;
  v_source_task_id uuid;
  v_cycle atlas.crop_cycles%rowtype;
  v_source atlas.tasks%rowtype;
  v_task_link_count integer := 0;
  v_source_link_count integer := 0;
  v_cycles jsonb;
begin
  if p_service_date is null
     or coalesce(v_card#>>'{transition,state}','') <> 'not_routed' then
    return v_card;
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id
    and task.farm_id=p_farm_id
    and task.status='open'
    and (
      task.assigned_membership_id=p_membership_id
      or task.metadata->>'executor_membership_id'=p_membership_id::text
    );

  if v_task.id is null then
    return v_card;
  end if;

  -- Germination-driven thinning: the completed germination observation is the
  -- exact warrant for the next operation on the same canonical crop cycle.
  if coalesce(v_task.action_key,'')='thin'
     and coalesce(v_task.operation_class,'')='remove_uproot'
     and coalesce(v_task.task_type,'')='thinning'
     and nullif(v_task.metadata->>'crop_cycle_id','') is not null
     and nullif(v_task.metadata->>'source_germination_task_id','') is not null then
    begin
      v_cycle_id := (v_task.metadata->>'crop_cycle_id')::uuid;
      v_source_task_id := (v_task.metadata->>'source_germination_task_id')::uuid;
    exception when others then
      return v_card;
    end;

    select count(*) into v_task_link_count
    from atlas.task_crop_cycles link
    where link.task_id=p_task_id
      and link.crop_cycle_id=v_cycle_id
      and link.confidence='confirmed';

    select * into v_cycle
    from atlas.crop_cycles cycle
    where cycle.id=v_cycle_id
      and cycle.farm_id=p_farm_id
      and cycle.lifecycle_status='active'
      and cycle.cycle_state='germinated';

    select * into v_source
    from atlas.tasks task
    where task.id=v_source_task_id
      and task.farm_id=p_farm_id
      and task.status='done'
      and task.metadata->>'crop_cycle_id'=v_cycle_id::text
      and task.metadata->>'spacing_outcome'='thin';

    select count(*) into v_source_link_count
    from atlas.task_crop_cycles link
    where link.task_id=v_source_task_id
      and link.crop_cycle_id=v_cycle_id
      and link.confidence='confirmed';

    if v_task_link_count=1
       and v_cycle.id is not null
       and v_source.id is not null
       and v_source_link_count=1
       and coalesce(nullif(v_card#>>'{currentReality,subjectCount}','')::integer,0)=1 then

      select jsonb_agg(
        case
          when elem->>'cropCycleId'=v_cycle_id::text then
            jsonb_set(
              jsonb_set(elem,'{fittingOperation}',jsonb_build_object(
                'state','available',
                'source','germination_spacing_outcome',
                'currentTaskId',p_task_id,
                'operationClass','remove_uproot',
                'sourceTaskId',v_source_task_id
              ),true),
              '{operationIdentity}',jsonb_build_object(
                'state','canonical_followup_task_match',
                'source','source_germination_task.spacing_outcome',
                'currentTaskId',p_task_id,
                'cropCycleId',v_cycle_id,
                'sourceTaskId',v_source_task_id
              ),true
            )
          else elem
        end
        order by ord
      ) into v_cycles
      from jsonb_array_elements(coalesce(v_card#>'{currentReality,cropCycles}','[]'::jsonb)) with ordinality x(elem,ord);

      if v_cycles is not null then
        v_card:=jsonb_set(v_card,'{currentReality,cropCycles}',v_cycles,true);
      end if;
      v_card:=jsonb_set(v_card,'{currentReality,resolutionRequiredSubjectCount}','0'::jsonb,true);
      v_card:=jsonb_set(v_card,'{fittingFunction,state}',to_jsonb('exact_identity_supported'::text),true);
      v_card:=jsonb_set(v_card,'{fittingFunction,exactIdentityMismatchCount}','0'::jsonb,true);
      v_card:=jsonb_set(v_card,'{fittingFunction,operationIdentity}',jsonb_build_object(
        'state','canonical_followup_task_match',
        'source','source_germination_task.spacing_outcome',
        'cropCycleId',v_cycle_id,
        'sourceTaskId',v_source_task_id,
        'currentTaskId',p_task_id
      ),true);
      v_card:=jsonb_set(v_card,'{truthBoundary,followupCropIdentityBridge}',jsonb_build_object(
        'kind','germination_driven_thinning',
        'requiresExactCropCycleLink',true,
        'requiresCompletedSourceGerminationTask',true,
        'requiresSourceSpacingOutcome','thin',
        'requiresSameCropCycleOnSourceAndFollowup',true,
        'doesNotInferPhysicalCompletion',true
      ),true);
      return v_card;
    end if;
  end if;

  -- Owner-defined serial batch pot-up: the explicit confirmed preserves links
  -- plus the batch schedule identify the living crop subjects without pretending
  -- an old sowing task is the current operation.
  if coalesce(v_task.action_key,'')='pot_up'
     and coalesce(v_task.operation_class,'')='establish_aboveground'
     and coalesce(v_task.metadata->>'work_route','')='pot_up'
     and coalesce(v_task.metadata->>'task_work_shape','')='batch'
     and nullif(v_task.metadata->>'schedule_batch_key','') is not null
     and coalesce((v_task.metadata->>'batch_item_count')::integer,0)>0 then

    select count(*) into v_task_link_count
    from atlas.task_crop_cycles link
    join atlas.crop_cycles cycle on cycle.id=link.crop_cycle_id
    where link.task_id=p_task_id
      and link.confidence='confirmed'
      and link.role='preserves'
      and cycle.farm_id=p_farm_id
      and cycle.lifecycle_status='active';

    if v_task_link_count>0
       and v_task_link_count=coalesce(nullif(v_card#>>'{currentReality,subjectCount}','')::integer,0)
       and exists (
         select 1
         from atlas.task_crop_cycles link
         where link.task_id=p_task_id
           and link.confidence='confirmed'
           and link.role='preserves'
           and link.source='owner_instruction'
           and link.metadata->>'schedule_batch_key'=v_task.metadata->>'schedule_batch_key'
       ) then

      select jsonb_agg(
        jsonb_set(
          jsonb_set(elem,'{fittingOperation}',jsonb_build_object(
            'state','available',
            'source','owner_batch_pot_up_schedule',
            'currentTaskId',p_task_id,
            'operationClass','establish_aboveground',
            'scheduleBatchKey',v_task.metadata->>'schedule_batch_key'
          ),true),
          '{operationIdentity}',jsonb_build_object(
            'state','canonical_batch_task_match',
            'source','task_crop_cycles.confirmed_preserves',
            'currentTaskId',p_task_id,
            'scheduleBatchKey',v_task.metadata->>'schedule_batch_key'
          ),true
        )
        order by ord
      ) into v_cycles
      from jsonb_array_elements(coalesce(v_card#>'{currentReality,cropCycles}','[]'::jsonb)) with ordinality x(elem,ord);

      if v_cycles is not null then
        v_card:=jsonb_set(v_card,'{currentReality,cropCycles}',v_cycles,true);
      end if;
      v_card:=jsonb_set(v_card,'{currentReality,resolutionRequiredSubjectCount}','0'::jsonb,true);
      v_card:=jsonb_set(v_card,'{fittingFunction,state}',to_jsonb('exact_identity_supported'::text),true);
      v_card:=jsonb_set(v_card,'{fittingFunction,exactIdentityMismatchCount}','0'::jsonb,true);
      v_card:=jsonb_set(v_card,'{fittingFunction,operationIdentity}',jsonb_build_object(
        'state','canonical_batch_task_match',
        'source','task_crop_cycles.confirmed_preserves',
        'currentTaskId',p_task_id,
        'scheduleBatchKey',v_task.metadata->>'schedule_batch_key'
      ),true);
      v_card:=jsonb_set(v_card,'{truthBoundary,followupCropIdentityBridge}',jsonb_build_object(
        'kind','owner_defined_batch_pot_up',
        'requiresConfirmedPreservesLinks',true,
        'requiresOwnerInstructionScheduleWitness',true,
        'requiresAllLinkedCyclesActive',true,
        'doesNotReplaceCropCycleSourceTask',true,
        'doesNotInferPhysicalCompletion',true
      ),true);
      return v_card;
    end if;
  end if;

  return v_card;
end;
$function$;

revoke all on function atlas.worker_state_transition_followup_crop_bridge_v1(uuid,uuid,uuid,date,jsonb) from public, anon, authenticated;

create or replace function atlas.worker_state_transition_selection_bridge_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date,
  p_card jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_card jsonb := coalesce(p_card,'{}'::jsonb);
  v_task atlas.tasks%rowtype;
  v_readiness jsonb;
  v_capacity record;
  v_selected boolean := false;
  v_subject_count integer := 0;
  v_exact_subject_identity boolean := false;
begin
  v_subject_count:=coalesce(nullif(v_card#>>'{currentReality,subjectCount}','')::integer,0);
  v_exact_subject_identity:=v_subject_count>0
    and coalesce(nullif(v_card#>>'{currentReality,resolutionRequiredSubjectCount}','')::integer,0)=0
    and coalesce(v_card#>>'{fittingFunction,state}','')='exact_identity_supported'
    and coalesce(nullif(v_card#>>'{fittingFunction,exactIdentityMismatchCount}','')::integer,0)=0;

  if p_service_date is null
     or coalesce(v_card#>>'{transition,state}','') <> 'not_routed'
     or coalesce(v_card#>>'{routing,state}','') <> 'not_placed_for_worker_day'
     or (v_subject_count<>0 and not v_exact_subject_identity) then
    return v_card;
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id
    and task.farm_id=p_farm_id
    and task.status='open'
    and (
      task.assigned_membership_id=p_membership_id
      or task.metadata->>'executor_membership_id'=p_membership_id::text
    );

  if v_task.id is null then
    return v_card;
  end if;

  select exists(
    select 1
    from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,p_service_date) selection
    where selection.task_id=p_task_id
      and selection.presentation_state='presented'
      and coalesce(selection.overload,false)=false
  ) into v_selected;

  if not v_selected then
    return v_card;
  end if;

  v_readiness:=atlas.task_execution_readiness_v1(p_task_id);
  if not coalesce((v_readiness->>'ready')::boolean,false)
     or coalesce((v_card#>>'{clock,definiteCapacityConflict}')::boolean,false) then
    return v_card;
  end if;

  select cp.expected_active_minutes, cp.physical_load
  into v_capacity
  from atlas.task_capacity_plan_v1(v_task,p_service_date) cp;

  v_card:=jsonb_set(v_card,'{routing,state}',to_jsonb('selected_for_worker_day'::text),true);
  v_card:=jsonb_set(v_card,'{routing,selectionAuthority}',jsonb_build_object(
    'state','canonical_presented_selection',
    'serviceDate',p_service_date,
    'subjectMode',case when v_subject_count=0 then 'zero_subject' else 'exact_subject_identity' end,
    'principle','Canonical Worker Day selection may establish same-day execution jurisdiction without inventing exact Clock placement; subject-bearing work must already have exact Reality identity.'
  ),true);
  v_card:=jsonb_set(v_card,'{jurisdiction,state}',to_jsonb('selected_body_established'::text),true);
  v_card:=jsonb_set(v_card,'{clock,selectionClaim}',jsonb_build_object(
    'state','presented_without_persisted_time_placement',
    'exactTimeClaim',false,
    'principle','Selection authorizes today ownership only; it does not invent an exact Clock start time.'
  ),true);
  v_card:=jsonb_set(v_card,'{transition,state}',to_jsonb('authorized_for_routed_day'::text),true);
  v_card:=jsonb_set(v_card,'{transition,authorizedInstruction}',jsonb_strip_nulls(jsonb_build_object(
    'actionKey',v_task.action_key,
    'operationClass',v_task.operation_class,
    'do',coalesce(nullif(v_task.metadata->>'execution_do',''),v_task.title),
    'doneWhen',nullif(v_task.metadata->>'execution_done_when',''),
    'dayWindow',atlas.worker_task_day_window_v1(v_task.action_key,v_task.task_type,v_task.metadata),
    'plannedStartAt',null,
    'plannedDurationMinutes',v_capacity.expected_active_minutes
  )),true);
  v_card:=jsonb_set(v_card,'{truthBoundary,selectedDayBridge}',jsonb_build_object(
    'zeroSubjectAllowed',true,
    'subjectBearingRequiresExactRealityIdentity',true,
    'requiresCanonicalPresentedSelection',true,
    'requiresExecutionReadiness',true,
    'requiresNoDefiniteCapacityConflict',true,
    'doesNotCreateClockPlacement',true,
    'doesNotResolveCropOrProductionReality',true
  ),true);

  return v_card;
end;
$function$;

create or replace function atlas.worker_task_requires_structured_result_v1(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_metadata jsonb;
  v_route text;
  v_created_from text;
  v_joined text;
  v_quick text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then return true; end if;

  v_metadata:=coalesce(v_task.metadata,'{}'::jsonb);
  v_route:=lower(btrim(coalesce(v_metadata->>'work_route','')));
  v_created_from:=lower(btrim(coalesce(v_metadata->>'created_from','')));
  v_joined:=lower(concat_ws(' ',v_task.task_type,v_task.action_key,v_task.generated_from,v_route,v_created_from));
  v_quick:=lower(btrim(coalesce(v_metadata->>'quick_complete_allowed','')));

  if v_quick in ('true','yes','1') then return false; end if;
  if v_quick in ('false','no','0') then return true; end if;

  if lower(btrim(coalesce(v_metadata->>'structured_result_required',''))) in ('true','yes','1')
     or lower(btrim(coalesce(v_metadata->>'result_capture_required',''))) in ('true','yes','1')
     or lower(btrim(coalesce(v_metadata->>'planting_log_required',''))) in ('true','yes','1')
     or lower(btrim(coalesce(v_metadata->>'requires_result',''))) in ('true','yes','1')
     or nullif(btrim(coalesce(v_metadata->>'capture_kind','')),'') is not null
  then return true; end if;

  -- Canonical thinning has a dedicated task card whose task transition itself is
  -- the physical witness. Crop-cycle identity is required for authorization, but
  -- no extra domain result fields are required after the operation is exact.
  if lower(coalesce(v_task.action_key,''))='thin'
     and lower(coalesce(v_task.task_type,''))='thinning'
     and lower(coalesce(v_task.operation_class,''))='remove_uproot' then
    return false;
  end if;

  if v_route in ('crop_cycle','seed','plant','harvest')
     or v_created_from='crop_cycle_triggered_sequence'
     or v_metadata ? 'crop_cycle_id'
     or v_metadata ? 'crop_cycle_key'
     or v_metadata ? 'crop_profile_stable_key'
     or lower(coalesce(v_task.action_key,'')) in ('sow','seed_sowing','plant','transplant','harvest')
     or v_joined ~ '(germination|harvest|transplant|planting|readiness|production)'
  then return true; end if;

  return false;
end;
$function$;

create or replace function atlas.worker_state_transition_card_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_card jsonb;
  v_task atlas.tasks%rowtype;
  v_authorized boolean;
  v_is_germination boolean:=false;
  v_is_direct_sow_seed boolean:=false;
  v_requires_structured boolean:=true;
  v_result_contract jsonb;
begin
  v_card:=atlas.worker_state_transition_card_pre_or4_v2(p_farm_id,p_membership_id,p_task_id,p_service_date);
  v_card:=atlas.worker_state_transition_planned_establishment_bridge_v1(p_farm_id,p_membership_id,p_task_id,p_service_date,v_card);
  v_card:=atlas.worker_state_transition_followup_crop_bridge_v1(p_farm_id,p_membership_id,p_task_id,p_service_date,v_card);
  v_card:=atlas.worker_state_transition_selection_bridge_v1(p_farm_id,p_membership_id,p_task_id,p_service_date,v_card);

  select * into v_task from atlas.tasks where id=p_task_id and farm_id=p_farm_id;
  if v_task.id is not null then
    v_is_germination:=atlas.is_germination_task_v1(v_task);
    v_is_direct_sow_seed:=coalesce(v_task.metadata->>'seed_governance_required','false')='true'
      and coalesce(v_task.metadata->>'seed_inventory_report_required','false')='true'
      and (coalesce(v_task.action_key,'')='sow' or coalesce(v_task.metadata->>'work_route','')='sow');
    v_requires_structured:=atlas.worker_task_requires_structured_result_v1(v_task.id);
  end if;
  v_authorized:=coalesce(v_card #>> '{transition,state}','')='authorized_for_routed_day';

  v_result_contract:=case
    when not v_authorized then jsonb_build_object(
      'state','operation_result_not_authorized','contractVersion','worker_record_state_transition_result_v1',
      'choices',jsonb_build_array('inspect'),'requiredFields','[]'::jsonb,'optionalFields','[]'::jsonb,
      'principle','No result may be returned for an operation Reality Expression has not authorized.'
    )
    when v_is_germination then jsonb_build_object(
      'state','structured_result_v1_available','contractVersion','worker_record_state_transition_result_v1','domainAdapter','germination_observation_v2',
      'choices',jsonb_build_array('not_yet','beginning','germinated','failed_or_uncertain','problem_found'),
      'requiredFields',jsonb_build_array('actualMinutes','idempotencyKey'),
      'conditionalFields',jsonb_build_object('germinated',jsonb_build_array('resultPayload.spacingOutcome'),'spacingOutcomeChoices',jsonb_build_array('thin','on_target','patch')),
      'optionalFields',jsonb_build_array('quantity','unit','note','resultPayload.targetSpacingInches'),
      'doneInvariant','Germinated closes the task only inside the same transaction that records the operation actual and reclassifies the canonical crop-cycle state.',
      'observationInvariant','The worker returns the physical observation; Atlas derives task status, rhythm satisfaction, continuation, and any handoff from that observation.'
    )
    when v_is_direct_sow_seed then jsonb_build_object(
      'state','structured_result_v1_available','contractVersion','record_direct_sow_seed_result_for_member_v1','domainAdapter','direct_sow_seed_v1',
      'choices',jsonb_build_array('depleted','exact_remaining','some_left_unknown'),
      'requiredFields',jsonb_build_array('actualMinutes','idempotencyKey'),
      'conditionalFields',jsonb_build_object('exact_remaining',jsonb_build_array('remainingQuantity')),
      'optionalFields',jsonb_build_array('note'),
      'doneInvariant','The sowing task closes only after the seed remainder event is recorded and the canonical seed state is reclassified in the same transaction.',
      'observationInvariant','Report only what is physically known after sowing: none left, an exact remaining count, or some left but unmeasured. Atlas must not infer an exact balance from task completion.'
    )
    when coalesce(v_task.metadata->>'task_style','')='farm_round' or coalesce(v_task.action_key,'')='farm_round' then jsonb_build_object(
      'state','aggregate_member_completion_only','contractVersion','farm_round_member_completion_v1',
      'choices',jsonb_build_array('complete_members'),
      'requiredFields','[]'::jsonb,'optionalFields','[]'::jsonb,
      'principle','Farm Round parent completion is derived from terminal member tasks; the parent has no direct Done result.'
    )
    when v_requires_structured then jsonb_build_object(
      'state','structured_result_adapter_required','contractVersion','worker_record_state_transition_result_v1',
      'choices',jsonb_build_array('inspect'),'requiredFields','[]'::jsonb,'optionalFields','[]'::jsonb,
      'principle','This authorized operation needs a domain result adapter before generic Done is allowed.'
    )
    else jsonb_build_object(
      'state','quick_complete_v1_available','contractVersion','worker_quick_complete_v1',
      'choices',jsonb_build_array('done'),'requiredFields',jsonb_build_array('idempotencyKey'),'optionalFields',jsonb_build_array('note'),
      'transition','done','principle','This authorized operation may close through the canonical task transition because no additional domain witness fields are required.'
    )
  end;

  v_card:=jsonb_set(v_card,'{contractVersion}',to_jsonb('worker_state_transition_card_v2'::text),true);
  v_card:=jsonb_set(v_card,'{resultReturn}',v_result_contract,true);
  v_card:=jsonb_set(v_card,'{truthBoundary,resultContractDeferredToPhase6}','false'::jsonb,true);
  v_card:=jsonb_set(v_card,'{truthBoundary,quickCompleteAuthority}',to_jsonb('canonical_result_return'::text),true);
  return v_card;
end;
$function$;
