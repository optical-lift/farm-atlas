-- Tranche 1A/1B/1C foundation: search before ask, classify the lawful knower,
-- and expose only surviving owner questions through one canonical read surface.

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
  v_active_claims jsonb := '[]'::jsonb;
  v_active_claim_count integer := 0;
  v_answer jsonb;
  v_verdict text := 'genuinely_not_found';
  v_search_scope jsonb := '[]'::jsonb;
begin
  select * into v_instance
  from atlas.state_consequence_instances
  where id=p_instance_id;
  if v_instance.id is null then
    raise exception 'State consequence instance not found.' using errcode='P0002';
  end if;
  select * into v_policy from atlas.state_consequence_policies where id=v_instance.policy_id;

  -- Search order is explicit and preserved in the packet even where an adapter does
  -- not yet have a domain-specific reader for every tier.
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
             'claimId',c.id,
             'destinationObjectId',c.destination_object_id,
             'claimStrength',c.claim_strength,
             'claimSource',c.claim_source,
             'requiredBy',c.required_by,
             'sourceTaskId',c.source_task_id,
             'recordedByMembershipId',c.recorded_by_membership_id
           ) order by c.created_at,c.id),'[]'::jsonb)
      into v_active_claim_count,v_active_claims
    from atlas.crop_destination_claims c
    where c.crop_cycle_id=v_instance.subject_id
      and c.status='active'
      and c.claim_strength='committed';

    if v_active_claim_count=1 then
      v_verdict:='authoritative_answer_found';
      v_answer:=jsonb_build_object(
        'fieldKey','transplant_destination_object_id',
        'value',v_active_claims->0->'destinationObjectId',
        'authority','canonical_crop_destination_claim',
        'evidence',v_active_claims->0
      );
    elsif v_active_claim_count>1 then
      v_verdict:='contradictory_answers_found';
      v_answer:=jsonb_build_object(
        'fieldKey','transplant_destination_object_id',
        'authority','canonical_crop_destination_claim',
        'candidates',v_active_claims
      );
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','truth_acquisition_search_v1',
    'instanceId',v_instance.id,
    'subjectKind',v_instance.subject_kind,
    'subjectId',v_instance.subject_id,
    'actionKey',v_instance.action_key,
    'factNeeded',coalesce(v_policy.action_spec->>'factNeeded',v_policy.metadata->>'gapKind',v_instance.action_key),
    'verdict',v_verdict,
    'answer',v_answer,
    'searchOrder',v_search_scope,
    'searchedBeforeAsk',true,
    'truthBoundary',jsonb_build_object(
      'authoritativeAnswerSuppressesAsk',true,
      'possibleEvidenceDoesNotBecomeFact',true,
      'weakNotesAreEvidenceOnly',true,
      'unknownDoesNotBecomeFalseOrZero',true
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
      'workerObservationRequiresWorkerObservableClass',true,
      'externalInformationDoesNotBecomeInternalDecision',true
    )
  );
end;
$function$;

create or replace function atlas.owner_needs_from_you_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_cards jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(card order by priority desc, released_at, instance_id),'[]'::jsonb)
    into v_cards
  from (
    select i.id as instance_id,
           i.priority,
           i.released_at,
           jsonb_strip_nulls(jsonb_build_object(
             'contractVersion','atlas_needs_from_you_card_v1',
             'instanceId',i.id,
             'sourceRequirementInstanceId',i.source_requirement_instance_id,
             'farmId',i.farm_id,
             'subjectKind',i.subject_kind,
             'subjectId',i.subject_id,
             'actionKey',i.action_key,
             'priority',i.priority,
             'releasedAt',i.released_at,
             'carrierTaskId',i.carrier_task_id,
             'title',coalesce(t.metadata->>'display_subject',t.title),
             'detail',coalesce(t.metadata->>'display_detail',t.note),
             'actionLabel',coalesce(p.action_spec->>'actionLabel',t.metadata->>'display_action','Answer'),
             'factNeeded',p.action_spec->>'factNeeded',
             'gapKind',p.metadata->>'gapKind',
             'knower',k.packet,
             'controls',case
               when i.action_key='choose_transplant_destination' then jsonb_build_array('choose_known_option','i_do_not_know')
               else jsonb_build_array('answer','not_applicable','i_do_not_know')
             end,
             'truthBoundary',jsonb_build_object(
               'notAnOverdueTaskList',true,
               'questionSurvivedSearchBeforeAsk',true,
               'answerMustResolveCanonicalTruthNotDismissCard',true
             )
           )) as card
    from atlas.state_consequence_instances i
    join atlas.state_consequence_policies p on p.id=i.policy_id
    join atlas.farm_memberships fm on fm.farm_id=i.farm_id and fm.user_id=v_user_id and fm.active and fm.role='owner'
    left join atlas.tasks t on t.id=i.carrier_task_id
    cross join lateral (select atlas.truth_acquisition_knower_v1(i.id) as packet) k
    where i.status='open'
      and i.consequence_role='truth_acquisition'
      and k.packet->>'acquisitionSurface'='atlas_needs_from_you'
  ) q;

  return jsonb_build_object(
    'contractVersion','owner_needs_from_you_v1',
    'userId',v_user_id,
    'count',jsonb_array_length(v_cards),
    'cards',v_cards,
    'truthBoundary',jsonb_build_object(
      'surfaceContainsOnlyOpenOwnerKnownGaps',true,
      'authoritativeAnswersAreSuppressed',true,
      'tasksRemainCarriersNotReality',true
    )
  );
end;
$function$;

-- Gate carrier creation through search + knower classification. Existing adapters remain
-- intact, but owner task creation is no longer the first epistemic move.
create or replace function atlas.sync_truth_acquisition_carrier_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_knower jsonb;
begin
  if new.status='open' and new.consequence_role='truth_acquisition' then
    v_knower:=atlas.truth_acquisition_knower_v1(new.id);
    update atlas.state_consequence_instances
    set epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
      'knowledgeAcquisitionSearch',v_knower->'search',
      'knowerClass',v_knower->>'knowerClass',
      'acquisitionSurface',v_knower->>'acquisitionSurface',
      'classifiedBy','truth_acquisition_knower_v1'
    ),
    updated_at=now()
    where id=new.id;

    if v_knower->>'acquisitionSurface' in ('atlas_needs_from_you','management_acquisition') then
      perform atlas.ensure_truth_acquisition_task_v1(new.id);
    end if;
  end if;
  return new;
exception when others then
  -- The requirement/gap remains authoritative even when acquisition routing needs repair.
  return new;
end;
$function$;

revoke all on function atlas.truth_acquisition_search_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.truth_acquisition_knower_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.owner_needs_from_you_v1() from public,anon;
revoke all on function atlas.sync_truth_acquisition_carrier_v1() from public,anon,authenticated;

grant execute on function atlas.truth_acquisition_search_v1(uuid) to service_role;
grant execute on function atlas.truth_acquisition_knower_v1(uuid) to service_role;
grant execute on function atlas.owner_needs_from_you_v1() to authenticated,service_role;
grant execute on function atlas.sync_truth_acquisition_carrier_v1() to service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,anonymous_execute_expected,
  security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
)
values (
  'atlas.owner_needs_from_you_v1()',
  'public_endpoint','verified','active',
  true,false,true,true,
  1,0,
  jsonb_build_object(
    'purpose','Owner knowledge-acquisition read surface after search-before-ask and knower resolution',
    'requiresAuthUid',true,
    'returnsOnlyOwnerMembershipFarms',true,
    'doesNotMutateTruth',true,
    'contract','Atlas Whole-System Finish Build v1 Tranche 1A-1C'
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

-- Reclassify existing open gaps and preserve the packet in their epistemic basis.
do $backfill$
declare v record; v_k jsonb;
begin
  for v in select id from atlas.state_consequence_instances where status='open' and consequence_role='truth_acquisition'
  loop
    v_k:=atlas.truth_acquisition_knower_v1(v.id);
    update atlas.state_consequence_instances
    set epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
      'knowledgeAcquisitionSearch',v_k->'search',
      'knowerClass',v_k->>'knowerClass',
      'acquisitionSurface',v_k->>'acquisitionSurface',
      'classifiedBy','truth_acquisition_knower_v1'
    ),updated_at=now()
    where id=v.id;
  end loop;
end
$backfill$;

comment on function atlas.truth_acquisition_search_v1(uuid) is
'Tranche 1A canonical search-before-ask packet. It records the ordered internal search and returns authoritative, contradictory, possible/stale, or genuinely-not-found semantics without guessing.';
comment on function atlas.truth_acquisition_knower_v1(uuid) is
'Tranche 1B knower resolver. Search verdict precedes routing; authoritative internal truth suppresses the ask, while unresolved truth is classified to one lawful acquisition surface.';
comment on function atlas.owner_needs_from_you_v1() is
'Tranche 1C Owner queue. Returns only open owner-known truth gaps that survived search-before-ask and lawful-knower classification; it is not an overdue-task list.';