begin;

create index if not exists crop_occupancy_evidence_relation_witness_context_idx
  on atlas.crop_occupancy_evidence ((metadata ->> 'contextCropCycleId'), created_at)
  where metadata ->> 'evidenceClass' = 'relation_witness';

create unique index if not exists crop_occupancy_evidence_relation_witness_idempotency_uidx
  on atlas.crop_occupancy_evidence (
    farm_id,
    (metadata ->> 'contextCropCycleId'),
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

  if p_requirement_key like 'cooccupant_current_presence:%' then
    if p_observed_result not in ('present','absent','uncertain') then
      raise exception 'Current-presence evidence requires observed result present, absent, or uncertain.' using errcode = '22023';
    end if;
  elsif nullif(btrim(coalesce(p_observed_result, '')), '') is null and p_evidence = '{}'::jsonb then
    raise exception 'This requirement needs an observation result or an evidence payload.' using errcode = '22023';
  end if;

  v_idempotency_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');

  if v_idempotency_key is not null then
    select evidence.id
    into v_evidence_id
    from atlas.crop_occupancy_evidence evidence
    where evidence.farm_id = v_context.farm_id
      and evidence.metadata ->> 'evidenceClass' = 'relation_witness'
      and evidence.metadata ->> 'contextCropCycleId' = v_context.id::text
      and evidence.metadata ->> 'idempotencyKey' = v_idempotency_key
    order by evidence.created_at
    limit 1;

    if v_evidence_id is not null then
      return jsonb_build_object(
        'evidenceId', v_evidence_id,
        'created', false,
        'idempotentReplay', true,
        'contextCropCycleId', v_context.id,
        'requirementKey', p_requirement_key
      );
    end if;
  end if;

  v_metadata := jsonb_build_object(
    'evidenceClass', 'relation_witness',
    'contextCropCycleId', v_context.id,
    'requirementKey', p_requirement_key,
    'observedResult', nullif(btrim(coalesce(p_observed_result, '')), ''),
    'targetCropCycleId', v_target.id,
    'witnessUserId', v_actor_user_id,
    'witnessMembershipId', v_membership_id,
    'witnessRole', v_role,
    'payload', p_evidence,
    'neutral', true,
    'adjudicated', false,
    'idempotencyKey', v_idempotency_key
  );

  begin
    insert into atlas.crop_occupancy_evidence (
      farm_id, object_id, crop_cycle_id,
      evidence_role, evidence_date, confidence, metadata
    )
    values (
      v_context.farm_id, v_context.object_id, v_target.id,
      'observation', coalesce(p_evidence_date, current_date), p_confidence, v_metadata
    )
    returning id into v_evidence_id;
  exception when unique_violation then
    if v_idempotency_key is null then
      raise;
    end if;
    select evidence.id
    into v_evidence_id
    from atlas.crop_occupancy_evidence evidence
    where evidence.farm_id = v_context.farm_id
      and evidence.metadata ->> 'evidenceClass' = 'relation_witness'
      and evidence.metadata ->> 'contextCropCycleId' = v_context.id::text
      and evidence.metadata ->> 'idempotencyKey' = v_idempotency_key
    order by evidence.created_at
    limit 1;
    return jsonb_build_object(
      'evidenceId', v_evidence_id,
      'created', false,
      'idempotentReplay', true,
      'contextCropCycleId', v_context.id,
      'requirementKey', p_requirement_key
    );
  end;

  return jsonb_build_object(
    'evidenceId', v_evidence_id,
    'created', true,
    'idempotentReplay', false,
    'contextCropCycleId', v_context.id,
    'targetCropCycleId', v_target.id,
    'requirementKey', p_requirement_key,
    'observedResult', nullif(btrim(coalesce(p_observed_result, '')), ''),
    'evidenceDate', coalesce(p_evidence_date, current_date),
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
      'rule', 'The observation is now evidence only. Authorized adjudication remains a separate operation.'
    )
  );
end;
$function$;

revoke all on function atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text) from public;
revoke execute on function atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text) from anon;
revoke execute on function atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text) from service_role;
grant execute on function atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text) to authenticated;

comment on function atlas.record_crop_relation_evidence_v1(uuid,text,text,jsonb,date,text,text) is
  'Neutral authenticated witness intake for Reality Expression crop relation evidence. Appends evidence only; does not mutate crop lifecycle, placement geometry, planting claims, or adjudicated relation state.';

create or replace function atlas.crop_cycle_relation_witness_evidence_v1(p_context_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context atlas.crop_cycles%rowtype;
  v_entries jsonb := '[]'::jsonb;
  v_by_requirement jsonb := '{}'::jsonb;
  v_group record;
  v_conflict_count integer := 0;
begin
  if p_context_crop_cycle_id is null then
    raise exception 'A context crop cycle is required.' using errcode = '22023';
  end if;
  select * into v_context from atlas.crop_cycles where id = p_context_crop_cycle_id;
  if v_context.id is null then
    raise exception 'Context crop cycle not found.' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'evidenceId', evidence.id,
    'targetCropCycleId', evidence.crop_cycle_id,
    'requirementKey', evidence.metadata ->> 'requirementKey',
    'observedResult', evidence.metadata ->> 'observedResult',
    'evidenceDate', evidence.evidence_date,
    'confidence', evidence.confidence,
    'witness', jsonb_build_object(
      'userId', evidence.metadata ->> 'witnessUserId',
      'membershipId', evidence.metadata ->> 'witnessMembershipId',
      'role', evidence.metadata ->> 'witnessRole'
    ),
    'payload', coalesce(evidence.metadata -> 'payload', '{}'::jsonb),
    'neutral', true,
    'adjudicated', coalesce((evidence.metadata ->> 'adjudicated')::boolean, false),
    'createdAt', evidence.created_at
  ) order by evidence.evidence_date, evidence.created_at, evidence.id), '[]'::jsonb)
  into v_entries
  from atlas.crop_occupancy_evidence evidence
  where evidence.farm_id = v_context.farm_id
    and evidence.object_id = v_context.object_id
    and evidence.metadata ->> 'evidenceClass' = 'relation_witness'
    and evidence.metadata ->> 'contextCropCycleId' = v_context.id::text;

  for v_group in
    select
      evidence.metadata ->> 'requirementKey' as requirement_key,
      count(*)::integer as evidence_count,
      count(distinct nullif(evidence.metadata ->> 'observedResult','')) filter (
        where nullif(evidence.metadata ->> 'observedResult','') in ('present','absent')
      )::integer as decisive_result_count,
      coalesce(jsonb_agg(distinct to_jsonb(nullif(evidence.metadata ->> 'observedResult',''))) filter (
        where nullif(evidence.metadata ->> 'observedResult','') is not null
      ), '[]'::jsonb) as observed_results,
      max(evidence.created_at) as latest_at
    from atlas.crop_occupancy_evidence evidence
    where evidence.farm_id = v_context.farm_id
      and evidence.object_id = v_context.object_id
      and evidence.metadata ->> 'evidenceClass' = 'relation_witness'
      and evidence.metadata ->> 'contextCropCycleId' = v_context.id::text
    group by evidence.metadata ->> 'requirementKey'
  loop
    if v_group.decisive_result_count > 1 then
      v_conflict_count := v_conflict_count + 1;
    end if;
    v_by_requirement := v_by_requirement || jsonb_build_object(
      v_group.requirement_key,
      jsonb_build_object(
        'state', case when v_group.decisive_result_count > 1 then 'conflicting' else 'received' end,
        'evidenceCount', v_group.evidence_count,
        'observedResults', v_group.observed_results,
        'latestAt', v_group.latest_at,
        'adjudicationState', 'pending_or_separate'
      )
    );
  end loop;

  return jsonb_build_object(
    'contractVersion', 'crop_cycle_relation_witness_evidence_v1',
    'asOf', now(),
    'contextCropCycleId', v_context.id,
    'evidenceCount', jsonb_array_length(v_entries),
    'conflictCount', v_conflict_count,
    'byRequirement', v_by_requirement,
    'entries', v_entries,
    'truthBoundary', jsonb_build_object(
      'evidenceOnly', true,
      'automaticAdjudication', false,
      'automaticCropStateMutation', false,
      'automaticSpatialMutation', false
    )
  );
end;
$function$;

revoke all on function atlas.crop_cycle_relation_witness_evidence_v1(uuid) from public;
revoke execute on function atlas.crop_cycle_relation_witness_evidence_v1(uuid) from anon;
revoke execute on function atlas.crop_cycle_relation_witness_evidence_v1(uuid) from authenticated;
grant execute on function atlas.crop_cycle_relation_witness_evidence_v1(uuid) to service_role;

comment on function atlas.crop_cycle_relation_witness_evidence_v1(uuid) is
  'Read-only service/internal projection of neutral relation witness evidence. Reports receipt/conflict without adjudicating represented reality.';

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
      'detail','Two or more neutral witnesses supplied conflicting present/absent evidence for at least one relation requirement. Atlas preserves the conflict and does not adjudicate it automatically.'
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

comment on function atlas.crop_cycle_relation_resolution_requirements_v2(uuid) is
  'Reality Expression relation-resolution contract with neutral witness intake availability and evidence receipt/conflict projection. Read-only; adjudication remains separate.';

create or replace function atlas.crop_cycle_reality_expression_v4(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_base jsonb;
  v_resolution jsonb;
  v_result jsonb;
begin
  v_base := atlas.crop_cycle_reality_expression_v2(p_crop_cycle_id);
  v_resolution := atlas.crop_cycle_relation_resolution_requirements_v2(p_crop_cycle_id);
  v_result := v_base || jsonb_build_object(
    'contractVersion','crop_cycle_reality_expression_v4',
    'baseContractVersion',v_base ->> 'contractVersion',
    'resolutionBoundary',v_resolution - 'issues'
  );
  v_result := jsonb_set(
    v_result,
    '{issues}',
    coalesce(v_base -> 'issues','[]'::jsonb) || coalesce(v_resolution -> 'issues','[]'::jsonb),
    true
  );
  return v_result;
end;
$function$;

revoke all on function atlas.crop_cycle_reality_expression_v4(uuid) from public;
revoke execute on function atlas.crop_cycle_reality_expression_v4(uuid) from anon;
revoke execute on function atlas.crop_cycle_reality_expression_v4(uuid) from authenticated;
grant execute on function atlas.crop_cycle_reality_expression_v4(uuid) to service_role;

comment on function atlas.crop_cycle_reality_expression_v4(uuid) is
  'Reality Expression v4: living-body + spatial truth + neutral relation witness evidence boundary. Read-only service/internal composition.';

insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, reviewed_at
)
values
(
  'atlas.record_crop_relation_evidence_v1(uuid, text, text, jsonb, date, text, text)',
  'app_endpoint','verified','active',true,true,false,0,0,
  jsonb_build_object(
    'purpose','Allow an active farm member to append neutral witness evidence for one currently requested crop-relation question.',
    'boundary','Authenticated farm membership is enforced inside the function. Service automation is not allowed to impersonate a witness.',
    'truthLaw','The command appends evidence only. It does not mutate crop lifecycle state, planting claims, placement geometry, or adjudicated relation state.'
  ),now()
),
(
  'atlas.crop_cycle_relation_witness_evidence_v1(uuid)',
  'service_internal','verified','active',false,false,true,1,0,
  jsonb_build_object(
    'purpose','Project neutral relation witness evidence for one crop-cycle context.',
    'boundary','Service/internal read only.',
    'truthLaw','Receipt and conflict are visible; neither is automatic adjudication.'
  ),now()
),
(
  'atlas.crop_cycle_relation_resolution_requirements_v2(uuid)',
  'service_internal','verified','active',false,false,true,1,0,
  jsonb_build_object(
    'purpose','Compose concrete relation requirements with the now-available neutral witness intake and evidence receipt state.',
    'boundary','Read only. Existing owner/manager adjudication jurisdictions remain intact.',
    'truthLaw','Evidence may satisfy the need for a witness without itself satisfying the need for authorized adjudication.'
  ),now()
),
(
  'atlas.crop_cycle_reality_expression_v4(uuid)',
  'service_internal','verified','active',false,false,true,0,0,
  jsonb_build_object(
    'purpose','Compose living crop truth, spatial truth, and neutral relation witness evidence for one crop cycle.',
    'boundary','Service/internal read model only.',
    'truthLaw','The packet exposes what is known, witnessed, conflicting, still unadjudicated, and still missing without forcing completeness.'
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

commit;
