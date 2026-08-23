create or replace function atlas.answer_owner_needs_from_you_v1(
  p_instance_id uuid,
  p_answer_kind text,
  p_destination_object_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_instance atlas.state_consequence_instances%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_knower jsonb;
  v_destination atlas.growing_objects%rowtype;
  v_write jsonb;
  v_claim_id uuid;
  v_transition jsonb;
  v_after atlas.state_consequence_instances%rowtype;
  v_source_status text;
  v_answer_kind text:=lower(btrim(coalesce(p_answer_kind,'')));
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode='42501';
  end if;
  if p_instance_id is null or nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception 'Question instance and idempotency key are required.' using errcode='22023';
  end if;
  if v_answer_kind not in ('choose_destination','i_do_not_know') then
    raise exception 'Unsupported owner knowledge answer kind.' using errcode='22023';
  end if;

  select * into v_instance
  from atlas.state_consequence_instances
  where id=p_instance_id
  for update;
  if v_instance.id is null then
    raise exception 'Knowledge acquisition question was not found.' using errcode='P0002';
  end if;

  select * into v_member
  from atlas.farm_memberships
  where farm_id=v_instance.farm_id and user_id=v_user_id and active and role='owner'
  order by created_at
  limit 1;
  if v_member.id is null then
    raise exception 'Active Owner membership is required for this question.' using errcode='42501';
  end if;

  if v_instance.status<>'open' or v_instance.consequence_role<>'truth_acquisition' then
    return jsonb_build_object(
      'contractVersion','answer_owner_needs_from_you_v1',
      'instanceId',v_instance.id,
      'state','already_resolved',
      'status',v_instance.status,
      'idempotent',true
    );
  end if;

  v_knower:=atlas.truth_acquisition_knower_v1(v_instance.id);
  if v_knower->>'acquisitionSurface'<>'atlas_needs_from_you' then
    raise exception 'This unresolved fact is not currently assigned to Atlas Needs From You.' using errcode='22023';
  end if;

  if v_answer_kind='i_do_not_know' then
    update atlas.state_consequence_instances
    set epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
          'ownerKnowledgeResponse',jsonb_build_object(
            'kind','i_do_not_know',
            'membershipId',v_member.id,
            'answeredAt',now(),
            'releaseGeneration',release_generation,
            'idempotencyKey',btrim(p_idempotency_key)
          ),
          'knowerClass','actually_unknown',
          'acquisitionSurface','unresolved_unknown',
          'classifiedBy','owner_needs_from_you_answer_v1'
        ),
        updated_at=now()
    where id=v_instance.id;

    if v_instance.carrier_task_id is not null
       and exists(select 1 from atlas.tasks where id=v_instance.carrier_task_id and status in ('open','blocked')) then
      v_transition:=atlas.record_task_transition_v1_internal(
        v_instance.carrier_task_id,
        'done',
        left('owner-does-not-know:'||v_instance.id::text||':'||v_instance.release_generation::text,160),
        null,
        'Owner answered I don''t know. The missing fact remains unresolved and is no longer assigned to the Owner queue.',
        'owner_knowledge_response',
        'truth_acquisition',
        v_instance.action_key,
        jsonb_build_object(
          'completion_source','owner_not_knower',
          'state_consequence_instance_id',v_instance.id,
          'source_requirement_instance_id',v_instance.source_requirement_instance_id,
          'answered_by_membership_id',v_member.id,
          'fact_resolved',false
        ),
        null
      );
    end if;

    select * into v_after from atlas.state_consequence_instances where id=v_instance.id;
    return jsonb_build_object(
      'contractVersion','answer_owner_needs_from_you_v1',
      'instanceId',v_after.id,
      'state','owner_not_knower',
      'factResolved',false,
      'questionStatus',v_after.status,
      'knower',atlas.truth_acquisition_knower_v1(v_after.id),
      'carrierTransition',v_transition,
      'truthBoundary',jsonb_build_object(
        'unknownRemainsUnknown',true,
        'sourceRequirementRemainsIndependent',true,
        'ownerQueueAssignmentRemovedWithoutInventingFact',true
      )
    );
  end if;

  if v_instance.action_key<>'choose_transplant_destination' or v_instance.subject_kind<>'crop_cycle' then
    raise exception 'Destination answers are only supported for crop-cycle transplant destination questions.' using errcode='22023';
  end if;
  if p_destination_object_id is null then
    raise exception 'Destination object is required.' using errcode='22023';
  end if;

  select * into v_destination from atlas.growing_objects where id=p_destination_object_id;
  if v_destination.id is null or v_destination.farm_id is distinct from v_instance.farm_id then
    raise exception 'Destination object must belong to the same farm as the question.' using errcode='22023';
  end if;

  v_write:=atlas.record_crop_destination_claim_v1(
    v_instance.subject_id,
    v_destination.id,
    null,
    null,
    coalesce(v_instance.requirement_known_active_by,(now() at time zone 'America/Chicago')::date),
    'committed',
    'principal',
    'Owner answered Atlas Needs From You.',
    v_instance.carrier_task_id,
    'owner_knowledge_acquisition',
    jsonb_build_object(
      'stateConsequenceInstanceId',v_instance.id,
      'sourceRequirementInstanceId',v_instance.source_requirement_instance_id,
      'ownerMembershipId',v_member.id,
      'answerKind','choose_destination',
      'answeredAt',now()
    ),
    btrim(p_idempotency_key)
  );

  v_claim_id:=nullif(v_write->>'claimId','')::uuid;
  if v_claim_id is not null then
    update atlas.crop_destination_claims
    set recorded_by_membership_id=v_member.id,
        source_evidence=coalesce(source_evidence,'{}'::jsonb)||jsonb_build_object(
          'ownerMembershipId',v_member.id,
          'source','atlas_needs_from_you'
        ),
        updated_at=now()
    where id=v_claim_id;
  end if;

  perform atlas.reconcile_crop_cycle_requirement_state_v1(v_instance.subject_id);

  select * into v_after from atlas.state_consequence_instances where id=v_instance.id;
  if v_after.status<>'resolved' then
    raise exception 'Canonical destination was recorded but the acquisition consequence did not resolve; transaction rolled back.' using errcode='P0001';
  end if;
  if v_after.source_requirement_instance_id is not null then
    select status into v_source_status from atlas.state_consequence_instances where id=v_after.source_requirement_instance_id;
  end if;

  return jsonb_build_object(
    'contractVersion','answer_owner_needs_from_you_v1',
    'instanceId',v_after.id,
    'state','canonical_answer_recorded',
    'factResolved',true,
    'answerKind','choose_destination',
    'destinationObject',jsonb_build_object('id',v_destination.id,'label',v_destination.label,'stableKey',v_destination.stable_key),
    'canonicalWrite',v_write,
    'questionStatus',v_after.status,
    'sourceRequirementStatus',v_source_status,
    'resolutionContinuation',v_after.epistemic_basis->'resolutionContinuation',
    'truthBoundary',jsonb_build_object(
      'answerRecordedCanonically',true,
      'carrierTaskNotReality',true,
      'sourceRequirementRemainsIndependent',true,
      'transactionFailsIfPropagationFails',true
    )
  );
end;
$function$;