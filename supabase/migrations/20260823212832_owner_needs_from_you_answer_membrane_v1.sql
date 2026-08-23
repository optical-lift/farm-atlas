-- Tranche 1D: answer once, propagate everywhere.
-- Authenticated Owner answers land through the existing canonical destination-claim writer.
-- "I don't know" is preserved as epistemic truth and removes the item from the Owner-known lane
-- without fabricating or resolving the missing operational fact.

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
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.id is null then
    raise exception 'State consequence instance not found.' using errcode='P0002';
  end if;
  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;

  v_search:=atlas.truth_acquisition_search_v1(v_instance.id);
  v_jurisdiction:=atlas.truth_acquisition_jurisdiction_v1(v_instance.id);

  if v_search->>'verdict'='authoritative_answer_found' then
    v_knower_class:='already_known';
    v_acquisition_surface:='none';
  elsif v_search->>'verdict'='contradictory_answers_found' then
    v_knower_class:='contradictory';
    v_acquisition_surface:='owner_review';
  elsif coalesce((v_instance.epistemic_basis->>'ownerUnableToAnswer')::boolean,false) then
    v_knower_class:='actually_unknown';
    v_acquisition_surface:='unresolved_unknown';
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
    'contractVersion','truth_acquisition_knower_v1',
    'instanceId',v_instance.id,
    'search',v_search,
    'knowerClass',v_knower_class,
    'acquisitionSurface',v_acquisition_surface,
    'jurisdiction',v_jurisdiction,
    'askOwner',(v_acquisition_surface='atlas_needs_from_you'),
    'truthBoundary',jsonb_build_object(
      'knowerClassificationDoesNotCreateFact',true,
      'ownerQuestionRequiresSearchFirst',true,
      'ownerDoesNotKnowRemainsUnknown',true,
      'workerObservationRequiresWorkerObservableClass',true,
      'externalInformationDoesNotBecomeInternalDecision',true
    )
  );
end;
$function$;

create or replace function atlas.answer_owner_needs_from_you_v1(
  p_instance_id uuid,
  p_answer_kind text,
  p_destination_object_id uuid default null,
  p_note text default null,
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
  v_membership atlas.farm_memberships%rowtype;
  v_destination atlas.growing_objects%rowtype;
  v_knower jsonb;
  v_claim jsonb;
  v_existing atlas.crop_destination_claims%rowtype;
  v_after atlas.state_consequence_instances%rowtype;
  v_key text;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  if p_instance_id is null then raise exception 'Truth-acquisition instance is required.' using errcode='22023'; end if;
  if p_answer_kind not in ('destination','i_do_not_know') then
    raise exception 'Unsupported answer kind.' using errcode='22023';
  end if;

  select * into v_instance
  from atlas.state_consequence_instances
  where id=p_instance_id
  for update;
  if v_instance.id is null then raise exception 'Truth-acquisition instance not found.' using errcode='P0002'; end if;

  select * into v_membership
  from atlas.farm_memberships
  where farm_id=v_instance.farm_id and user_id=v_user_id and active and role='owner'
  order by created_at,id
  limit 1;
  if v_membership.id is null then raise exception 'Owner membership required.' using errcode='42501'; end if;

  if v_instance.status<>'open' or v_instance.consequence_role<>'truth_acquisition' then
    return jsonb_build_object('instanceId',v_instance.id,'state','not_open','status',v_instance.status);
  end if;

  v_knower:=atlas.truth_acquisition_knower_v1(v_instance.id);
  if v_knower->>'acquisitionSurface'<>'atlas_needs_from_you' then
    return jsonb_build_object(
      'instanceId',v_instance.id,
      'state','not_owner_question',
      'knower',v_knower,
      'truthBoundary',jsonb_build_object('noWritePerformed',true)
    );
  end if;

  if p_answer_kind='i_do_not_know' then
    update atlas.state_consequence_instances
    set epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
          'ownerUnableToAnswer',true,
          'ownerUnableToAnswerAt',now(),
          'ownerUnableToAnswerMembershipId',v_membership.id,
          'ownerUnableToAnswerNote',nullif(btrim(coalesce(p_note,'')),'')
        ),
        updated_at=now()
    where id=v_instance.id
    returning * into v_after;

    return jsonb_build_object(
      'contractVersion','answer_owner_needs_from_you_v1',
      'instanceId',v_instance.id,
      'state','still_unknown',
      'resolved',false,
      'nextKnower',atlas.truth_acquisition_knower_v1(v_instance.id),
      'truthBoundary',jsonb_build_object(
        'unknownWasNotConvertedToFact',true,
        'sourceRequirementRemainsOpen',true,
        'ownerCardRemovedFromOwnerKnownLane',true
      )
    );
  end if;

  if v_instance.subject_kind<>'crop_cycle' or v_instance.action_key<>'choose_transplant_destination' then
    raise exception 'This Owner answer adapter does not support the truth-acquisition family yet.' using errcode='0A000';
  end if;
  if p_destination_object_id is null then raise exception 'Destination object is required.' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'Idempotency key is required.' using errcode='22023'; end if;

  select * into v_destination
  from atlas.growing_objects
  where id=p_destination_object_id and farm_id=v_instance.farm_id;
  if v_destination.id is null then raise exception 'Destination object is not in this farm.' using errcode='22023'; end if;

  v_key:='owner-needs-from-you:'||v_instance.id::text||':'||btrim(p_idempotency_key);
  select * into v_existing
  from atlas.crop_destination_claims
  where farm_id=v_instance.farm_id and idempotency_key=v_key;
  if v_existing.id is not null and v_existing.destination_object_id<>p_destination_object_id then
    raise exception 'Idempotency key was already used for a different destination.' using errcode='23505';
  end if;

  v_claim:=atlas.record_crop_destination_claim_v1(
    v_instance.subject_id,
    p_destination_object_id,
    null,
    null,
    null,
    'committed',
    'owner',
    'Owner answer to Atlas Needs From You.',
    v_instance.carrier_task_id,
    'owner_needs_from_you',
    jsonb_strip_nulls(jsonb_build_object(
      'truthAcquisitionInstanceId',v_instance.id,
      'sourceRequirementInstanceId',v_instance.source_requirement_instance_id,
      'answeredByMembershipId',v_membership.id,
      'answeredByUserId',v_user_id,
      'answeredAt',now(),
      'note',nullif(btrim(coalesce(p_note,'')),'')
    )),
    v_key
  );

  perform atlas.reconcile_crop_cycle_requirement_state_v1(v_instance.subject_id);
  select * into v_after from atlas.state_consequence_instances where id=v_instance.id;

  return jsonb_build_object(
    'contractVersion','answer_owner_needs_from_you_v1',
    'instanceId',v_instance.id,
    'state',case when v_after.status='resolved' then 'resolved_and_propagated' else 'canonical_answer_recorded' end,
    'claim',v_claim,
    'instanceStatus',v_after.status,
    'searchAfter',atlas.truth_acquisition_search_v1(v_instance.id),
    'truthBoundary',jsonb_build_object(
      'answerWrittenToCanonicalDomainTruth',true,
      'carrierTaskNotUsedAsTruthStore',true,
      'requirementReconciledAfterAnswer',true,
      'downstreamExecutionReevaluatedByExistingResolutionTrigger',true
    )
  );
end;
$function$;

revoke all on function atlas.truth_acquisition_knower_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.answer_owner_needs_from_you_v1(uuid,text,uuid,text,text) from public,anon;
grant execute on function atlas.truth_acquisition_knower_v1(uuid) to service_role;
grant execute on function atlas.answer_owner_needs_from_you_v1(uuid,text,uuid,text,text) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,anonymous_execute_expected,
  security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
)
values (
  'atlas.answer_owner_needs_from_you_v1(uuid, text, uuid, text, text)',
  'public_endpoint','verified','active',
  true,false,true,true,
  1,0,
  jsonb_build_object(
    'purpose','Owner answer membrane for Atlas Needs From You',
    'requiresAuthUid',true,
    'requiresActiveOwnerMembership',true,
    'canonicalWriter','record_crop_destination_claim_v1',
    'unknownPreservedAsUnknown',true,
    'doesNotExposeInternalDestinationWriter',true,
    'contract','Atlas Whole-System Finish Build v1 Tranche 1D'
  ),
  now()
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  anonymous_execute_expected=excluded.anonymous_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  reviewed_at=excluded.reviewed_at;

comment on function atlas.answer_owner_needs_from_you_v1(uuid,text,uuid,text,text) is
'Tranche 1D Owner write membrane. A destination answer writes canonical crop destination truth then reuses existing consequence and execution reconciliation. I-do-not-know remains epistemic unknown and never resolves the source requirement.';