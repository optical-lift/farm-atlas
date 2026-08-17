begin;

-- Idempotency belongs to one witnessing membership, not merely to a farm/context.
drop index if exists atlas.crop_occupancy_evidence_relation_witness_idempotency_uidx;
create unique index crop_occupancy_evidence_relation_witness_idempotency_uidx
  on atlas.crop_occupancy_evidence (
    farm_id,
    (metadata ->> 'contextCropCycleId'),
    (metadata ->> 'witnessMembershipId'),
    (metadata ->> 'idempotencyKey')
  )
  where metadata ->> 'evidenceClass' = 'relation_witness'
    and coalesce(metadata ->> 'idempotencyKey', '') <> '';

create or replace function atlas.record_crop_relation_evidence_v1(
  p_context_crop_cycle_id uuid,
  p_requirement_key text,
  p_observed_result text default null,
  p_evidence jsonb default '{}'::jsonb,
  p_evidence_date date default current_date,
  p_confidence text default 'medium',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context atlas.crop_cycles%rowtype;
  v_target atlas.crop_cycles%rowtype;
  v_requirement jsonb;
  v_requirement_set jsonb;
  v_target_crop_cycle_id uuid;
  v_actor_user_id uuid;
  v_membership_id uuid;
  v_role text;
  v_evidence_id uuid;
  v_metadata jsonb;
  v_idempotency_key text;
  v_observed_result text;
  v_effective_evidence_date date;
  v_request jsonb;
  v_existing atlas.crop_occupancy_evidence%rowtype;
  v_existing_request jsonb;
begin
  if p_context_crop_cycle_id is null then
    raise exception 'A context crop cycle is required.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_requirement_key, '')), '') is null then
    raise exception 'A requirement key is required.' using errcode = '22023';
  end if;
  if p_confidence not in ('low','medium','high','owner_confirmed') then
    raise exception 'Unsupported confidence: %', p_confidence using errcode = '22023';
  end if;
  if p_evidence_date is not null and p_evidence_date > current_date then
    raise exception 'Evidence date cannot be in the future.' using errcode = '22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'Evidence payload must be a JSON object.' using errcode = '22023';
  end if;

  select * into v_context
  from atlas.crop_cycles
  where id = p_context_crop_cycle_id;
  if v_context.id is null then
    raise exception 'Context crop cycle not found.' using errcode = 'P0002';
  end if;

  v_actor_user_id := auth.uid();
  if v_actor_user_id is null then
    raise exception 'A signed-in farm member is required to witness relation evidence.' using errcode = '42501';
  end if;

  v_role := atlas.current_farm_role(v_context.farm_id);
  v_membership_id := atlas.current_membership_id(v_context.farm_id);
  if v_role is null or v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;
  if p_confidence = 'owner_confirmed' and v_role <> 'owner' then
    raise exception 'Only an owner membership may submit owner_confirmed evidence.' using errcode = '42501';
  end if;

  v_requirement_set := atlas.crop_cycle_relation_resolution_requirements_v1(v_context.id);
  select requirement.value
  into v_requirement
  from jsonb_array_elements(coalesce(v_requirement_set -> 'requirements', '[]'::jsonb)) requirement(value)
  where requirement.value ->> 'key' = p_requirement_key
  limit 1;

  if v_requirement is null then
    raise exception 'Requirement key is not active for this crop-cycle reality packet: %', p_requirement_key using errcode = '22023';
  end if;

  v_target_crop_cycle_id := coalesce(
    nullif(v_requirement ->> 'subjectCropCycleId', '')::uuid,
    v_context.id
  );

  select * into v_target
  from atlas.crop_cycles
  where id = v_target_crop_cycle_id;
  if v_target.id is null
     or v_target.farm_id <> v_context.farm_id
     or v_target.object_id <> v_context.object_id then
    raise exception 'Requirement target is outside the context crop cycle farm/object boundary.' using errcode = '42501';
  end if;

  v_observed_result := nullif(btrim(coalesce(p_observed_result, '')), '');
  if p_requirement_key like 'cooccupant_current_presence:%' then
    if v_observed_result not in ('present','absent','uncertain') then
      raise exception 'Current-presence evidence requires observed result present, absent, or uncertain.' using errcode = '22023';
    end if;
  elsif v_observed_result is null and p_evidence = '{}'::jsonb then
    raise exception 'This requirement needs an observation result or an evidence payload.' using errcode = '22023';
  end if;

  v_idempotency_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_effective_evidence_date := coalesce(p_evidence_date, current_date);
  v_request := jsonb_build_object(
    'requirementKey', p_requirement_key,
    'observedResult', v_observed_result,
    'targetCropCycleId', v_target.id,
    'payload', p_evidence,
    'evidenceDate', v_effective_evidence_date,
    'confidence', p_confidence
  );

  if v_idempotency_key is not null then
    select evidence.*
    into v_existing
    from atlas.crop_occupancy_evidence evidence
    where evidence.farm_id = v_context.farm_id
      and evidence.metadata ->> 'evidenceClass' = 'relation_witness'
      and evidence.metadata ->> 'contextCropCycleId' = v_context.id::text
      and evidence.metadata ->> 'witnessMembershipId' = v_membership_id::text
      and evidence.metadata ->> 'idempotencyKey' = v_idempotency_key
    order by evidence.created_at
    limit 1;

    if v_existing.id is not null then
      v_existing_request := coalesce(
        v_existing.metadata -> 'request',
        jsonb_build_object(
          'requirementKey', v_existing.metadata ->> 'requirementKey',
          'observedResult', nullif(v_existing.metadata ->> 'observedResult', ''),
          'targetCropCycleId', v_existing.crop_cycle_id,
          'payload', coalesce(v_existing.metadata -> 'payload', '{}'::jsonb),
          'evidenceDate', v_existing.evidence_date,
          'confidence', v_existing.confidence
        )
      );

      if v_existing_request <> v_request then
        raise exception 'Idempotency key already belongs to a different relation witness request.' using errcode = '23505';
      end if;

      return jsonb_build_object(
        'evidenceId', v_existing.id,
        'created', false,
        'idempotentReplay', true,
        'contextCropCycleId', v_existing.metadata ->> 'contextCropCycleId',
        'targetCropCycleId', v_existing.crop_cycle_id,
        'requirementKey', v_existing.metadata ->> 'requirementKey',
        'observedResult', nullif(v_existing.metadata ->> 'observedResult', ''),
        'evidenceDate', v_existing.evidence_date,
        'confidence', v_existing.confidence,
        'witness', jsonb_build_object(
          'userId', v_existing.metadata ->> 'witnessUserId',
          'membershipId', v_existing.metadata ->> 'witnessMembershipId',
          'role', v_existing.metadata ->> 'witnessRole'
        ),
        'effect', jsonb_build_object(
          'cropStateMutated', false,
          'spatialTruthMutated', false,
          'plantingClaimMutated', false,
          'adjudicated', false,
          'rule', 'The observation is evidence only. Authorized adjudication remains a separate operation.'
        )
      );
    end if;
  end if;

  v_metadata := jsonb_build_object(
    'evidenceClass', 'relation_witness',
    'contextCropCycleId', v_context.id,
    'requirementKey', p_requirement_key,
    'observedResult', v_observed_result,
    'targetCropCycleId', v_target.id,
    'witnessUserId', v_actor_user_id,
    'witnessMembershipId', v_membership_id,
    'witnessRole', v_role,
    'payload', p_evidence,
    'neutral', true,
    'adjudicated', false,
    'idempotencyKey', v_idempotency_key,
    'request', v_request
  );

  begin
    insert into atlas.crop_occupancy_evidence (
      farm_id, object_id, crop_cycle_id,
      evidence_role, evidence_date, confidence, metadata
    )
    values (
      v_context.farm_id, v_context.object_id, v_target.id,
      'observation', v_effective_evidence_date, p_confidence, v_metadata
    )
    returning id into v_evidence_id;
  exception when unique_violation then
    if v_idempotency_key is null then
      raise;
    end if;

    select evidence.*
    into v_existing
    from atlas.crop_occupancy_evidence evidence
    where evidence.farm_id = v_context.farm_id
      and evidence.metadata ->> 'evidenceClass' = 'relation_witness'
      and evidence.metadata ->> 'contextCropCycleId' = v_context.id::text
      and evidence.metadata ->> 'witnessMembershipId' = v_membership_id::text
      and evidence.metadata ->> 'idempotencyKey' = v_idempotency_key
    order by evidence.created_at
    limit 1;

    if v_existing.id is null then
      raise;
    end if;

    v_existing_request := coalesce(
      v_existing.metadata -> 'request',
      jsonb_build_object(
        'requirementKey', v_existing.metadata ->> 'requirementKey',
        'observedResult', nullif(v_existing.metadata ->> 'observedResult', ''),
        'targetCropCycleId', v_existing.crop_cycle_id,
        'payload', coalesce(v_existing.metadata -> 'payload', '{}'::jsonb),
        'evidenceDate', v_existing.evidence_date,
        'confidence', v_existing.confidence
      )
    );

    if v_existing_request <> v_request then
      raise exception 'Idempotency key already belongs to a different relation witness request.' using errcode = '23505';
    end if;

    return jsonb_build_object(
      'evidenceId', v_existing.id,
      'created', false,
      'idempotentReplay', true,
      'contextCropCycleId', v_existing.metadata ->> 'contextCropCycleId',
      'targetCropCycleId', v_existing.crop_cycle_id,
      'requirementKey', v_existing.metadata ->> 'requirementKey',
      'observedResult', nullif(v_existing.metadata ->> 'observedResult', ''),
      'evidenceDate', v_existing.evidence_date,
      'confidence', v_existing.confidence,
      'witness', jsonb_build_object(
        'userId', v_existing.metadata ->> 'witnessUserId',
        'membershipId', v_existing.metadata ->> 'witnessMembershipId',
        'role', v_existing.metadata ->> 'witnessRole'
      ),
      'effect', jsonb_build_object(
        'cropStateMutated', false,
        'spatialTruthMutated', false,
        'plantingClaimMutated', false,
        'adjudicated', false,
        'rule', 'The observation is evidence only. Authorized adjudication remains a separate operation.'
      )
    );
  end;

  return jsonb_build_object(
    'evidenceId', v_evidence_id,
    'created', true,
    'idempotentReplay', false,
    'contextCropCycleId', v_context.id,
    'targetCropCycleId', v_target.id,
    'requirementKey', p_requirement_key,
    'observedResult', v_observed_result,
    'evidenceDate', v_effective_evidence_date,
    'confidence', p_confidence,
    'witness', jsonb_build_object(
      'userId', v_actor_user_id,
      'membershipId', v_membership_id,
      'role', v_role
    ),
    'effect', jsonb_build_object(
      'cropStateMutated', false,
      'spatialTruthMutated', false,
      'plantingClaimMutated', false,
      'adjudicated', false,
      'rule', 'The observation is evidence only. Authorized adjudication remains a separate operation.'
    )
  );
end;
$function$;

revoke all on function atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text) from public;
revoke execute on function atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text) from anon;
revoke execute on function atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text) from service_role;
grant execute on function atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text) to authenticated;

comment on function atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text) is
  'Neutral authenticated witness intake for Reality Expression crop relation evidence. Appends evidence only; idempotency is witness-scoped and exact-request safe; owner_confirmed requires owner membership; no crop lifecycle, placement geometry, planting claim, or adjudicated relation state mutation.';

create or replace function atlas.crop_cycle_relation_resolution_requirements_v2(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_base jsonb;
  v_evidence jsonb;
  v_requirements jsonb := '[]'::jsonb;
  v_requirement jsonb;
  v_summary jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_intake jsonb;
begin
  v_base := atlas.crop_cycle_relation_resolution_requirements_v1(p_crop_cycle_id);
  v_evidence := atlas.crop_cycle_relation_witness_evidence_v1(p_crop_cycle_id);

  for v_requirement in
    select value from jsonb_array_elements(coalesce(v_base -> 'requirements', '[]'::jsonb))
  loop
    v_summary := v_evidence -> 'byRequirement' -> (v_requirement ->> 'key');
    v_requirements := v_requirements || jsonb_build_array(
      v_requirement || jsonb_build_object(
        'evidenceState', coalesce(v_summary ->> 'state', 'none'),
        'witnessEvidence', coalesce(v_summary, jsonb_build_object(
          'state','none','evidenceCount',0,'observedResults','[]'::jsonb,'adjudicationState','not_started'
        ))
      )
    );
  end loop;

  select coalesce(jsonb_agg(issue.value), '[]'::jsonb)
  into v_issues
  from jsonb_array_elements(coalesce(v_base -> 'issues', '[]'::jsonb)) issue(value)
  where issue.value ->> 'key' <> 'neutral_relation_evidence_intake_missing';

  if coalesce((v_evidence ->> 'conflictCount')::integer, 0) > 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key','conflicting_relation_witness_evidence',
      'class','witness_conflict',
      'severity','attention',
      'detail','Neutral witness evidence contains conflicting present/absent observations for at least one relation requirement. Atlas preserves the conflict and does not adjudicate it automatically.'
    ));
  elsif coalesce((v_evidence ->> 'evidenceCount')::integer, 0) > 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key','relation_witness_evidence_pending_adjudication',
      'class','witness_evidence',
      'severity','information',
      'detail','Neutral relation evidence has been received. It remains evidence until the authorized spatial, lifecycle, or planting-claim mutation path adjudicates supported facts.'
    ));
  end if;

  v_intake := coalesce(v_base -> 'intakeBoundary', '{}'::jsonb);
  v_intake := jsonb_set(
    v_intake,
    '{neutralRelationEvidenceIntake}',
    jsonb_build_object(
      'state','available',
      'function','atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text)',
      'eligibleCaller','active_farm_membership',
      'directAuthenticatedTableInsert',false,
      'storage','atlas.crop_occupancy_evidence',
      'evidenceRole','observation',
      'idempotencyScope','context_crop_cycle + witnessing_membership + idempotency_key; exact semantic request required for replay',
      'ownerConfirmedBoundary','owner membership only',
      'mutationBoundary','append evidence only; no crop lifecycle, placement geometry, planting claim, or adjudicated relation mutation'
    ),
    true
  );

  return v_base || jsonb_build_object(
    'contractVersion','crop_cycle_relation_resolution_requirements_v2',
    'baseContractVersion',v_base ->> 'contractVersion',
    'intakeBoundary',v_intake,
    'requirements',v_requirements,
    'witnessEvidence',v_evidence,
    'issues',v_issues
  );
end;
$function$;

revoke all on function atlas.crop_cycle_relation_resolution_requirements_v2(uuid) from public;
revoke execute on function atlas.crop_cycle_relation_resolution_requirements_v2(uuid) from anon;
revoke execute on function atlas.crop_cycle_relation_resolution_requirements_v2(uuid) from authenticated;
grant execute on function atlas.crop_cycle_relation_resolution_requirements_v2(uuid) to service_role;

update atlas.authenticated_rpc_registry
set evidence = coalesce(evidence,'{}'::jsonb) || jsonb_build_object(
      'idempotencyBoundary','Idempotency is scoped to context crop cycle + witnessing membership + key and only exact semantic request replays are accepted.',
      'ownerConfirmedBoundary','owner_confirmed evidence requires an owner membership.'
    ),
    reviewed_at = now()
where signature='atlas.record_crop_relation_evidence_v1(uuid, text, text, jsonb, date, text, text)';

commit;
