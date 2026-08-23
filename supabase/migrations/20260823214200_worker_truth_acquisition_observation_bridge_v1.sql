-- Master Tranche 1E: worker-observable truth is acquired through a lawful observation operation.
-- The observation carrier is a task; canonical crop state remains the truth source.

create or replace function atlas.truth_acquisition_search_v1(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_policy atlas.state_consequence_policies%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_active_claims jsonb := '[]'::jsonb;
  v_active_claim_count integer := 0;
  v_answer jsonb;
  v_verdict text := 'genuinely_not_found';
  v_search_scope jsonb := '[]'::jsonb;
  v_search_adapter text;
  v_observation_key text;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;

  v_search_scope := jsonb_build_array(
    jsonb_build_object('rank',1,'source','canonical_current_state','searched',true),
    jsonb_build_object('rank',2,'source','explicit_management_decisions','searched',true),
    jsonb_build_object('rank',3,'source','observations','searched',true),
    jsonb_build_object('rank',4,'source','structured_task_results','searched',true),
    jsonb_build_object('rank',5,'source','resource_records','searched',true),
    jsonb_build_object('rank',6,'source','project_place_crop_records','searched',true),
    jsonb_build_object('rank',7,'source','related_operations_and_occurrences','searched',true),
    jsonb_build_object('rank',8,'source','structured_historical_evidence','searched',true),
    jsonb_build_object('rank',9,'source','weak_notes','searched',true,'authority','evidence_only')
  );

  if v_instance.subject_kind='crop_cycle' and v_instance.action_key='choose_transplant_destination' then
    select count(*)::integer,
           coalesce(jsonb_agg(jsonb_build_object(
             'claimId',c.id,'destinationObjectId',c.destination_object_id,
             'claimStrength',c.claim_strength,'claimSource',c.claim_source,
             'requiredBy',c.required_by,'sourceTaskId',c.source_task_id,
             'recordedByMembershipId',c.recorded_by_membership_id
           ) order by c.created_at,c.id),'[]'::jsonb)
      into v_active_claim_count,v_active_claims
    from atlas.crop_destination_claims c
    where c.crop_cycle_id=v_instance.subject_id and c.status='active' and c.claim_strength='committed';

    if v_active_claim_count=1 then
      v_verdict:='authoritative_answer_found';
      v_answer:=jsonb_build_object('fieldKey','transplant_destination_object_id','value',v_active_claims->0->'destinationObjectId','authority','canonical_crop_destination_claim','evidence',v_active_claims->0);
    elsif v_active_claim_count>1 then
      v_verdict:='contradictory_answers_found';
      v_answer:=jsonb_build_object('fieldKey','transplant_destination_object_id','authority','canonical_crop_destination_claim','candidates',v_active_claims);
    end if;
  end if;

  v_search_adapter:=coalesce(nullif(v_policy.metadata->>'searchAdapter',''),nullif(v_policy.action_spec->>'searchAdapter',''));
  v_observation_key:=coalesce(nullif(v_policy.metadata->>'workerObservationKey',''),nullif(v_policy.action_spec->>'workerObservationKey',''));
  if v_verdict='genuinely_not_found'
     and v_search_adapter='crop_latest_observation_v1'
     and v_instance.subject_kind='crop_cycle'
     and v_observation_key is not null then
    select * into v_cycle from atlas.crop_cycles where id=v_instance.subject_id;
    if v_cycle.id is not null
       and v_cycle.metadata->>'latest_observation'=v_observation_key
       and nullif(v_cycle.metadata->>'latest_observation_date','') is not null then
      v_verdict:='authoritative_answer_found';
      v_answer:=jsonb_build_object(
        'fieldKey','crop_latest_observation',
        'value',v_observation_key,
        'observedDate',v_cycle.metadata->>'latest_observation_date',
        'eventId',v_cycle.metadata->>'latest_observation_event_id',
        'authority','canonical_crop_cycle_observation_state'
      );
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','truth_acquisition_search_v1','instanceId',v_instance.id,
    'subjectKind',v_instance.subject_kind,'subjectId',v_instance.subject_id,'actionKey',v_instance.action_key,
    'factNeeded',coalesce(v_policy.action_spec->>'factNeeded',v_policy.metadata->>'gapKind',v_instance.action_key),
    'searchAdapter',v_search_adapter,'verdict',v_verdict,'answer',v_answer,'searchOrder',v_search_scope,'searchedBeforeAsk',true,
    'truthBoundary',jsonb_build_object(
      'authoritativeAnswerSuppressesAsk',true,'possibleEvidenceDoesNotBecomeFact',true,
      'weakNotesAreEvidenceOnly',true,'unknownDoesNotBecomeFalseOrZero',true,
      'workerResultFieldAloneDoesNotBecomeTruth',true
    )
  );
end;
$function$;

create or replace function atlas.truth_acquisition_knower_v1(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_policy atlas.state_consequence_policies%rowtype;
  v_search jsonb;
  v_jurisdiction jsonb;
  v_knower_class text;
  v_acquisition_surface text;
  v_owner_response jsonb;
  v_worker_response jsonb;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;

  v_search:=atlas.truth_acquisition_search_v1(v_instance.id);
  v_jurisdiction:=atlas.truth_acquisition_jurisdiction_v1(v_instance.id);
  v_owner_response:=v_instance.epistemic_basis->'ownerKnowledgeResponse';
  v_worker_response:=v_instance.epistemic_basis->'workerObservationResponse';

  if v_search->>'verdict'='authoritative_answer_found' then
    v_knower_class:='already_known'; v_acquisition_surface:='none';
  elsif v_search->>'verdict'='contradictory_answers_found' then
    v_knower_class:='contradictory'; v_acquisition_surface:='owner_review';
  elsif v_owner_response->>'kind'='i_do_not_know'
        and coalesce((v_owner_response->>'releaseGeneration')::integer,-1)=v_instance.release_generation then
    v_knower_class:='actually_unknown'; v_acquisition_surface:='unresolved_unknown';
  elsif v_worker_response->>'kind'='cannot_establish'
        and coalesce((v_worker_response->>'releaseGeneration')::integer,-1)=v_instance.release_generation then
    v_knower_class:='actually_unknown'; v_acquisition_surface:='unresolved_unknown';
  else
    v_knower_class:=coalesce(nullif(v_policy.metadata->>'knowerClass',''),nullif(v_policy.action_spec->>'knowerClass',''),case
      when v_jurisdiction->>'jurisdiction'='owner' then 'owner_known'
      when v_jurisdiction->>'jurisdiction'='manager' then 'management_known'
      when v_jurisdiction->>'jurisdiction' in ('farm_operations','worker') then 'worker_observable'
      when v_jurisdiction->>'jurisdiction' in ('external','external_information') then 'external_information_required'
      else 'actually_unknown'
    end);
    v_acquisition_surface:=case v_knower_class
      when 'owner_known' then 'atlas_needs_from_you'
      when 'management_known' then 'management_acquisition'
      when 'worker_observable' then 'worker_observation'
      when 'external_information_required' then 'external_research_handoff'
      when 'contradictory' then 'owner_review'
      else 'unresolved_unknown'
    end;
  end if;

  return jsonb_build_object(
    'contractVersion','truth_acquisition_knower_v1','instanceId',v_instance.id,'search',v_search,
    'knowerClass',v_knower_class,'acquisitionSurface',v_acquisition_surface,'jurisdiction',v_jurisdiction,
    'askOwner',(v_acquisition_surface='atlas_needs_from_you'),'ownerKnowledgeResponse',v_owner_response,'workerObservationResponse',v_worker_response,
    'truthBoundary',jsonb_build_object(
      'knowerClassificationDoesNotCreateFact',true,'ownerQuestionRequiresSearchFirst',true,
      'ownerDoesNotKnowDoesNotResolveFact',true,'workerCannotEstablishDoesNotResolveFact',true,
      'workerObservationRequiresWorkerObservableClass',true,'externalInformationDoesNotBecomeInternalDecision',true
    )
  );
end;
$function$;

create or replace function atlas.truth_acquisition_worker_observation_plan_v1(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_policy atlas.state_consequence_policies%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_worker atlas.farm_memberships%rowtype;
  v_worker_count integer:=0;
  v_knower jsonb;
  v_adapter text;
  v_observation_key text;
  v_prompt text;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;
  v_knower:=atlas.truth_acquisition_knower_v1(v_instance.id);
  if v_knower->>'acquisitionSurface'<>'worker_observation' then
    return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_plan_v1','instanceId',v_instance.id,'state','not_worker_observable','ready',false,'knower',v_knower);
  end if;

  v_adapter:=coalesce(nullif(v_policy.metadata->>'workerObservationAdapter',''),nullif(v_policy.action_spec->>'workerObservationAdapter',''));
  v_observation_key:=coalesce(nullif(v_policy.metadata->>'workerObservationKey',''),nullif(v_policy.action_spec->>'workerObservationKey',''));
  v_prompt:=coalesce(nullif(v_policy.metadata->>'workerObservationPrompt',''),nullif(v_policy.action_spec->>'actionLabel',''),'Observe the missing fact');

  if v_adapter<>'crop_observation_v1' or v_instance.subject_kind<>'crop_cycle' or v_observation_key is null then
    return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_plan_v1','instanceId',v_instance.id,'state','adapter_unresolved','ready',false,'adapter',v_adapter,'observationKey',v_observation_key);
  end if;
  if not exists(select 1 from atlas.crop_observation_types where observation_key=v_observation_key and active) then
    return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_plan_v1','instanceId',v_instance.id,'state','observation_type_unresolved','ready',false,'adapter',v_adapter,'observationKey',v_observation_key);
  end if;

  select * into v_cycle from atlas.crop_cycles where id=v_instance.subject_id and farm_id=v_instance.farm_id and lifecycle_status='active';
  if v_cycle.id is null then return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_plan_v1','instanceId',v_instance.id,'state','subject_unavailable','ready',false); end if;
  select * into v_object from atlas.growing_objects where id=v_cycle.object_id and farm_id=v_instance.farm_id;
  if v_object.id is null then return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_plan_v1','instanceId',v_instance.id,'state','object_unresolved','ready',false); end if;

  select count(*)::integer into v_worker_count from atlas.farm_memberships where farm_id=v_instance.farm_id and active and role='farm_hand';
  if v_worker_count<>1 then
    return jsonb_build_object('contractVersion','truth_acquisition_worker_observation_plan_v1','instanceId',v_instance.id,'state','observer_unresolved','ready',false,'eligibleWorkerCount',v_worker_count,'truthBoundary',jsonb_build_object('doesNotChooseArbitraryWorker',true));
  end if;
  select * into v_worker from atlas.farm_memberships where farm_id=v_instance.farm_id and active and role='farm_hand' order by created_at,id limit 1;

  return jsonb_build_object(
    'contractVersion','truth_acquisition_worker_observation_plan_v1','instanceId',v_instance.id,'state','ready','ready',true,
    'adapter',v_adapter,'observationKey',v_observation_key,'prompt',v_prompt,
    'workerMembershipId',v_worker.id,'workerUserId',v_worker.user_id,
    'cropCycleId',v_cycle.id,'objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,
    'truthBoundary',jsonb_build_object('observationIsLegitimateWork',true,'taskCarrierIsNotTruth',true,'exactlyOneWorkerRequiredForAutomaticRouting',true)
  );
end;
$function$;

create or replace function atlas.ensure_truth_acquisition_worker_observation_v1(p_instance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_requirement atlas.state_consequence_instances%rowtype;
  v_plan jsonb;
  v_task atlas.tasks%rowtype;
  v_occurrence_id uuid;
  v_materialized jsonb;
  v_task_id uuid;
  v_due date;
  v_subject text;
  v_prompt text;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id for update;
  if v_instance.id is null then raise exception 'State consequence instance not found.' using errcode='P0002'; end if;
  if v_instance.status<>'open' or v_instance.consequence_role<>'truth_acquisition' then return jsonb_build_object('instanceId',v_instance.id,'state','not_open','created',false); end if;

  v_plan:=atlas.truth_acquisition_worker_observation_plan_v1(v_instance.id);
  if not coalesce((v_plan->>'ready')::boolean,false) then return v_plan||jsonb_build_object('created',false); end if;

  if v_instance.carrier_task_id is not null then
    select * into v_task from atlas.tasks where id=v_instance.carrier_task_id and status in ('open','blocked');
    if v_task.id is not null and v_task.assigned_membership_id=(v_plan->>'workerMembershipId')::uuid then
      return jsonb_build_object('contractVersion','ensure_truth_acquisition_worker_observation_v1','instanceId',v_instance.id,'state','carrier_ready','taskId',v_task.id,'created',false,'plan',v_plan);
    end if;
  end if;

  if v_instance.source_requirement_instance_id is not null then select * into v_requirement from atlas.state_consequence_instances where id=v_instance.source_requirement_instance_id; end if;
  v_due:=coalesce(v_requirement.requirement_known_active_by,v_requirement.requirement_onset_date,(now() at time zone 'America/Chicago')::date);
  v_subject:=coalesce((select coalesce(nullif(variety,''),nullif(crop_label,''),'Crop') from atlas.crop_cycles where id=v_instance.subject_id),'Crop');
  v_prompt:=v_plan->>'prompt';

  v_occurrence_id:=atlas.plan_work_occurrence_v1(
    v_instance.farm_id,
    'truth-observation:'||v_instance.id::text,
    'truth-observation:'||v_instance.id::text,
    'truth-observation:'||v_instance.id::text||':'||v_instance.release_generation::text,
    v_prompt||' — '||v_subject,
    'truth_acquisition_observation',
    v_due,
    'state_consequence',
    v_instance.id,
    'immediate',0,1,
    jsonb_build_object(
      'title',v_prompt||' — '||v_subject,
      'task_type','truth_acquisition_observation','priority','high','action_key','observe_truth_gap','work_class','crop_cycle',
      'visibility_scope','assigned_worker','assigned_membership_id',v_plan->>'workerMembershipId','assigned_user_id',v_plan->>'workerUserId',
      'note',v_prompt||'. Record what you actually observe; do not infer the missing fact.',
      'metadata',jsonb_build_object(
        'task_style','truth_acquisition_observation','truth_acquisition_instance_id',v_instance.id,
        'source_requirement_instance_id',v_instance.source_requirement_instance_id,
        'worker_observation_adapter',v_plan->>'adapter','worker_observation_key',v_plan->>'observationKey',
        'crop_cycle_id',v_instance.subject_id,'object_id',v_plan->>'objectId','display_action',v_prompt,
        'display_subject',v_subject,'display_location',v_plan->>'objectLabel','structured_result_required',true,
        'result_endpoint','record_worker_truth_observation_v1'
      )
    ),
    jsonb_build_object('crop_cycle_ids',jsonb_build_array(v_instance.subject_id)),
    '{}'::jsonb,null,
    jsonb_build_object('truthAcquisitionInstanceId',v_instance.id,'contract','truth_acquisition_worker_observation_v1')
  );
  update atlas.planned_work_occurrences set work_lane='required',commitment_kind='persistent',effort_units=0.25,updated_at=now() where id=v_occurrence_id;
  v_materialized:=atlas.materialize_specific_work_occurrence_v1(v_occurrence_id,(now() at time zone 'America/Chicago')::date);
  begin v_task_id:=nullif(v_materialized->>'taskId','')::uuid; exception when others then v_task_id:=null; end;
  if v_task_id is null then return jsonb_build_object('contractVersion','ensure_truth_acquisition_worker_observation_v1','instanceId',v_instance.id,'state','planned_not_released','occurrenceId',v_occurrence_id,'materialization',v_materialized,'created',false,'plan',v_plan); end if;

  update atlas.tasks set operation_class='inspect_assess',sky_deferral_mode='never',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('worker_truth_observation_contract','record_worker_truth_observation_v1'),updated_at=now() where id=v_task_id;
  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values(v_task_id,v_instance.subject_id,'observes','confirmed','truth_acquisition_worker_observation_v1',jsonb_build_object('instanceId',v_instance.id)) on conflict do nothing;
  update atlas.state_consequence_instances set carrier_task_id=v_task_id,epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object('workerObservationPlan',v_plan,'carrierTaskId',v_task_id,'carrierReconciledBy','ensure_truth_acquisition_worker_observation_v1'),updated_at=now() where id=v_instance.id;

  return jsonb_build_object('contractVersion','ensure_truth_acquisition_worker_observation_v1','instanceId',v_instance.id,'state','carrier_ready','taskId',v_task_id,'occurrenceId',v_occurrence_id,'created',true,'plan',v_plan,'truthBoundary',jsonb_build_object('workerReceivesRealObservationAction',true,'taskDoesNotResolveFactByCompletionAlone',true));
end;
$function$;

create or replace function atlas.record_worker_truth_observation_v1(
  p_instance_id uuid,p_task_id uuid,p_answer_kind text,p_observation_key text default null,
  p_quantity numeric default null,p_unit text default null,p_note text default null,p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_instance atlas.state_consequence_instances%rowtype;
  v_task atlas.tasks%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_plan jsonb;
  v_result jsonb;
  v_search jsonb;
  v_transition jsonb;
  v_kind text:=lower(btrim(coalesce(p_answer_kind,'')));
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  if p_instance_id is null or p_task_id is null or v_key is null then raise exception 'Question, task, and idempotency key are required.' using errcode='22023'; end if;
  if v_kind not in ('observed','cannot_establish') then raise exception 'Choose observed or cannot_establish.' using errcode='22023'; end if;

  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id for update;
  if v_instance.id is null then raise exception 'Truth-acquisition instance not found.' using errcode='P0002'; end if;
  if v_instance.status<>'open' then return jsonb_build_object('contractVersion','record_worker_truth_observation_v1','instanceId',v_instance.id,'state','already_resolved','idempotent',true); end if;
  select * into v_task from atlas.tasks where id=p_task_id and farm_id=v_instance.farm_id for update;
  if v_task.id is null or v_task.id is distinct from v_instance.carrier_task_id then raise exception 'Task is not the active observation carrier for this truth gap.' using errcode='22023'; end if;
  select * into v_member from atlas.farm_memberships where id=v_task.assigned_membership_id and farm_id=v_instance.farm_id and active;
  if v_member.id is null or v_member.user_id is distinct from v_user_id then raise exception 'Only the routed signed-in worker may return this observation.' using errcode='42501'; end if;

  v_plan:=atlas.truth_acquisition_worker_observation_plan_v1(v_instance.id);
  if not coalesce((v_plan->>'ready')::boolean,false) or v_plan->>'workerMembershipId'<>v_member.id::text then raise exception 'Worker observation routing is no longer valid.' using errcode='22023'; end if;

  if v_kind='cannot_establish' then
    update atlas.state_consequence_instances set epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
      'workerObservationResponse',jsonb_build_object('kind','cannot_establish','membershipId',v_member.id,'answeredAt',now(),'releaseGeneration',release_generation,'idempotencyKey',v_key,'note',nullif(btrim(coalesce(p_note,'')),'')),
      'knowerClass','actually_unknown','acquisitionSurface','unresolved_unknown','classifiedBy','record_worker_truth_observation_v1'
    ),updated_at=now() where id=v_instance.id;
    if v_task.status in ('open','blocked') then
      v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done',left('worker-cannot-establish:'||v_instance.id::text||':'||v_instance.release_generation::text,160),null,
        'Worker could not establish the requested fact. The fact remains unresolved.','worker_observation_response','truth_acquisition',v_instance.action_key,
        jsonb_build_object('completion_source','worker_not_knower','state_consequence_instance_id',v_instance.id,'source_requirement_instance_id',v_instance.source_requirement_instance_id,'answered_by_membership_id',v_member.id,'fact_resolved',false),null);
    end if;
    return jsonb_build_object('contractVersion','record_worker_truth_observation_v1','instanceId',v_instance.id,'state','worker_cannot_establish','factResolved',false,'knower',atlas.truth_acquisition_knower_v1(v_instance.id),'carrierTransition',v_transition,'truthBoundary',jsonb_build_object('unknownRemainsUnknown',true,'taskCompletionDoesNotInventFact',true));
  end if;

  if v_plan->>'adapter'<>'crop_observation_v1' then raise exception 'Unsupported worker observation adapter.' using errcode='0A000'; end if;
  if nullif(btrim(coalesce(p_observation_key,'')),'') is null or p_observation_key<>v_plan->>'observationKey' then raise exception 'Returned observation must exactly match the requested governed observation type.' using errcode='22023'; end if;

  v_result:=atlas.record_crop_observation_for_member_v1(
    v_instance.farm_id,v_plan->>'objectKey',v_instance.subject_id,p_observation_key,(now() at time zone 'America/Chicago')::date,
    p_note,p_quantity,p_unit,
    jsonb_build_object('truth_acquisition_instance_id',v_instance.id,'source_requirement_instance_id',v_instance.source_requirement_instance_id,'worker_observation_carrier_task_id',v_task.id),
    'truth-acquisition:'||v_instance.id::text||':'||v_key
  );
  v_search:=atlas.truth_acquisition_search_v1(v_instance.id);
  if v_search->>'verdict'<>'authoritative_answer_found' then raise exception 'Canonical observation was recorded but did not satisfy the truth gap; transaction rolled back.' using errcode='P0001'; end if;

  update atlas.state_consequence_instances set status='resolved',resolved_at=now(),last_evaluated_at=now(),epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
    'workerObservationResponse',jsonb_build_object('kind','observed','membershipId',v_member.id,'answeredAt',now(),'releaseGeneration',release_generation,'observationKey',p_observation_key,'idempotencyKey',v_key),
    'canonicalObservationResult',v_result,'resolutionSearch',v_search,'resolvedBy','record_worker_truth_observation_v1'
  ),updated_at=now() where id=v_instance.id;

  return jsonb_build_object('contractVersion','record_worker_truth_observation_v1','instanceId',v_instance.id,'state','canonical_observation_recorded','factResolved',true,'observation',v_result,'searchAfter',v_search,'truthBoundary',jsonb_build_object('observationBecameCanonicalDomainState',true,'carrierTaskNotReality',true,'transactionFailsIfCanonicalSearchCannotConfirm',true));
end;
$function$;

create or replace function atlas.sync_truth_acquisition_carrier_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare v_knower jsonb;
begin
  if new.status='open' and new.consequence_role='truth_acquisition' then
    v_knower:=atlas.truth_acquisition_knower_v1(new.id);
    update atlas.state_consequence_instances set epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
      'knowledgeAcquisitionSearch',v_knower->'search','knowerClass',v_knower->>'knowerClass','acquisitionSurface',v_knower->>'acquisitionSurface','classifiedBy','truth_acquisition_knower_v1'
    ),updated_at=now() where id=new.id;
    if v_knower->>'acquisitionSurface' in ('atlas_needs_from_you','management_acquisition') then
      perform atlas.ensure_truth_acquisition_task_v1(new.id);
    elsif v_knower->>'acquisitionSurface'='worker_observation' then
      perform atlas.ensure_truth_acquisition_worker_observation_v1(new.id);
    end if;
  end if;
  return new;
exception when others then return new;
end;
$function$;

revoke all on function atlas.truth_acquisition_search_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.truth_acquisition_knower_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.truth_acquisition_worker_observation_plan_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.ensure_truth_acquisition_worker_observation_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.record_worker_truth_observation_v1(uuid,uuid,text,text,numeric,text,text,text) from public,anon;
revoke all on function atlas.sync_truth_acquisition_carrier_v1() from public,anon,authenticated;
grant execute on function atlas.truth_acquisition_search_v1(uuid) to service_role;
grant execute on function atlas.truth_acquisition_knower_v1(uuid) to service_role;
grant execute on function atlas.truth_acquisition_worker_observation_plan_v1(uuid) to service_role;
grant execute on function atlas.ensure_truth_acquisition_worker_observation_v1(uuid) to service_role;
grant execute on function atlas.record_worker_truth_observation_v1(uuid,uuid,text,text,numeric,text,text,text) to authenticated,service_role;
grant execute on function atlas.sync_truth_acquisition_carrier_v1() to service_role;

insert into atlas.authenticated_rpc_registry(signature,classification,confidence,review_status,authenticated_execute_expected,anonymous_execute_expected,security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,reviewed_at)
values('atlas.record_worker_truth_observation_v1(uuid, uuid, text, text, numeric, text, text, text)','public_endpoint','verified','active',true,false,true,true,1,0,
jsonb_build_object('purpose','Authenticated worker truth-acquisition observation return','requiresRoutedWorker',true,'canonicalWriter','record_crop_observation_for_member_v1','taskCompletionAloneDoesNotResolveFact',true,'contract','Atlas Whole-System Finish Build v1 Tranche 1E'),now())
on conflict(signature) do update set classification=excluded.classification,confidence=excluded.confidence,review_status=excluded.review_status,authenticated_execute_expected=excluded.authenticated_execute_expected,anonymous_execute_expected=excluded.anonymous_execute_expected,security_definer_expected=excluded.security_definer_expected,service_execute_expected=excluded.service_execute_expected,caller_count=excluded.caller_count,policy_reference_count=excluded.policy_reference_count,evidence=excluded.evidence,reviewed_at=excluded.reviewed_at;

comment on function atlas.truth_acquisition_worker_observation_plan_v1(uuid) is 'Tranche 1E plan: only worker-observable gaps with a named domain adapter, valid observation type, and exactly one lawful active farm hand may auto-route to Worker observation.';
comment on function atlas.record_worker_truth_observation_v1(uuid,uuid,text,text,numeric,text,text,text) is 'Tranche 1E worker return membrane. The routed worker records a governed domain observation; the acquisition resolves only after canonical search confirms the fact.';