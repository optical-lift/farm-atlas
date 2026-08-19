create table if not exists atlas.crop_relation_evidence_adjudications (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references atlas.crop_occupancy_evidence(id) on delete restrict,
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  context_crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict,
  requirement_key text not null check (btrim(requirement_key) <> ''),
  adjudication_state text not null check (adjudication_state in ('accepted','rejected_insufficient','conflict_unresolved','superseded')),
  rationale text not null check (btrim(rationale) <> ''),
  resulting_mutation jsonb not null default '{}'::jsonb check (jsonb_typeof(resulting_mutation) = 'object'),
  adjudicated_by_user_id uuid not null,
  adjudicated_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  adjudicated_by_role text not null,
  idempotency_key text,
  request jsonb not null default '{}'::jsonb check (jsonb_typeof(request) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists crop_relation_evidence_adjudications_evidence_created_idx
  on atlas.crop_relation_evidence_adjudications (evidence_id, created_at desc, id desc);
create index if not exists crop_relation_evidence_adjudications_farm_context_idx
  on atlas.crop_relation_evidence_adjudications (farm_id, context_crop_cycle_id, requirement_key, created_at desc);
create unique index if not exists crop_relation_evidence_adjudications_idempotency_uidx
  on atlas.crop_relation_evidence_adjudications (evidence_id, adjudicated_by_membership_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists crop_occupancy_relation_witness_continuity_idx
  on atlas.crop_occupancy_evidence (farm_id, ((metadata->>'evidenceClass')), ((metadata->>'contextCropCycleId')), ((metadata->>'requirementKey')), created_at desc)
  where metadata->>'evidenceClass'='relation_witness';

alter table atlas.crop_relation_evidence_adjudications enable row level security;
revoke all on table atlas.crop_relation_evidence_adjudications from public, anon, authenticated;

create or replace function atlas.record_crop_relation_evidence_adjudication_v1(
  p_evidence_id uuid,
  p_adjudication_state text,
  p_rationale text,
  p_resulting_mutation jsonb default '{}'::jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_evidence atlas.crop_occupancy_evidence%rowtype;
  v_context_crop_cycle_id uuid;
  v_requirement_key text;
  v_user_id uuid;
  v_membership_id uuid;
  v_role text;
  v_key text;
  v_request jsonb;
  v_existing atlas.crop_relation_evidence_adjudications%rowtype;
  v_id uuid;
begin
  if p_evidence_id is null then
    raise exception 'Relation evidence is required.' using errcode='22023';
  end if;
  if p_adjudication_state not in ('accepted','rejected_insufficient','conflict_unresolved','superseded') then
    raise exception 'Unsupported relation-evidence adjudication state: %', p_adjudication_state using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_rationale,'')),'') is null then
    raise exception 'Adjudication rationale is required.' using errcode='22023';
  end if;
  if p_resulting_mutation is null or jsonb_typeof(p_resulting_mutation)<>'object' then
    raise exception 'Resulting mutation reference must be a JSON object.' using errcode='22023';
  end if;

  select * into v_evidence from atlas.crop_occupancy_evidence where id=p_evidence_id;
  if v_evidence.id is null or v_evidence.metadata->>'evidenceClass'<>'relation_witness' then
    raise exception 'Neutral relation-witness evidence not found.' using errcode='P0002';
  end if;

  v_context_crop_cycle_id:=nullif(v_evidence.metadata->>'contextCropCycleId','')::uuid;
  v_requirement_key:=nullif(v_evidence.metadata->>'requirementKey','');
  if v_context_crop_cycle_id is null or v_requirement_key is null then
    raise exception 'Relation evidence is missing context or requirement identity.' using errcode='22023';
  end if;

  v_user_id:=auth.uid();
  if v_user_id is null then
    raise exception 'A signed-in owner is required to adjudicate relation evidence.' using errcode='42501';
  end if;
  v_role:=atlas.current_farm_role(v_evidence.farm_id);
  v_membership_id:=atlas.current_membership_id(v_evidence.farm_id);
  if v_role<>'owner' or v_membership_id is null then
    raise exception 'Owner membership is required to adjudicate relation evidence.' using errcode='42501';
  end if;

  v_key:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_request:=jsonb_build_object(
    'evidenceId',p_evidence_id,
    'adjudicationState',p_adjudication_state,
    'rationale',btrim(p_rationale),
    'resultingMutation',p_resulting_mutation
  );

  if v_key is not null then
    select * into v_existing
    from atlas.crop_relation_evidence_adjudications a
    where a.evidence_id=p_evidence_id
      and a.adjudicated_by_membership_id=v_membership_id
      and a.idempotency_key=v_key
    order by a.created_at,a.id
    limit 1;
    if v_existing.id is not null then
      if v_existing.request<>v_request then
        raise exception 'Idempotency key already belongs to a different adjudication request.' using errcode='23505';
      end if;
      return jsonb_build_object(
        'adjudicationId',v_existing.id,'created',false,'idempotentReplay',true,
        'evidenceId',v_existing.evidence_id,'contextCropCycleId',v_existing.context_crop_cycle_id,
        'requirementKey',v_existing.requirement_key,'adjudicationState',v_existing.adjudication_state,
        'rationale',v_existing.rationale,'resultingMutation',v_existing.resulting_mutation,
        'adjudicatedBy',jsonb_build_object('userId',v_existing.adjudicated_by_user_id,'membershipId',v_existing.adjudicated_by_membership_id,'role',v_existing.adjudicated_by_role),
        'effect',jsonb_build_object('witnessEvidenceMutated',false,'cropStateMutated',false,'spatialTruthMutated',false,'plantingClaimMutated',false,'domainMutationClaimedByThisFunction',false)
      );
    end if;
  end if;

  insert into atlas.crop_relation_evidence_adjudications (
    evidence_id,farm_id,context_crop_cycle_id,requirement_key,adjudication_state,rationale,resulting_mutation,
    adjudicated_by_user_id,adjudicated_by_membership_id,adjudicated_by_role,idempotency_key,request
  ) values (
    p_evidence_id,v_evidence.farm_id,v_context_crop_cycle_id,v_requirement_key,p_adjudication_state,btrim(p_rationale),p_resulting_mutation,
    v_user_id,v_membership_id,v_role,v_key,v_request
  ) returning id into v_id;

  return jsonb_build_object(
    'adjudicationId',v_id,'created',true,'idempotentReplay',false,
    'evidenceId',p_evidence_id,'contextCropCycleId',v_context_crop_cycle_id,
    'requirementKey',v_requirement_key,'adjudicationState',p_adjudication_state,
    'rationale',btrim(p_rationale),'resultingMutation',p_resulting_mutation,
    'adjudicatedBy',jsonb_build_object('userId',v_user_id,'membershipId',v_membership_id,'role',v_role),
    'effect',jsonb_build_object(
      'witnessEvidenceMutated',false,'cropStateMutated',false,'spatialTruthMutated',false,'plantingClaimMutated',false,
      'domainMutationClaimedByThisFunction',false,
      'rule','Adjudication records custody and judgment only. Any supported crop, spatial, lifecycle, or planting-claim mutation remains a separate authorized operation.'
    )
  );
end;
$function$;

revoke all on function atlas.record_crop_relation_evidence_adjudication_v1(uuid,text,text,jsonb,text) from public, anon;
grant execute on function atlas.record_crop_relation_evidence_adjudication_v1(uuid,text,text,jsonb,text) to authenticated;

create or replace function atlas.farm_relation_evidence_continuity_v1(
  p_farm_id uuid,
  p_as_of_date date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_day date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_pending jsonb:='[]'::jsonb;
  v_conflicts jsonb:='[]'::jsonb;
  v_pending_count integer:=0;
  v_conflict_count integer:=0;
  v_evidence_count integer:=0;
begin
  if p_farm_id is null or not exists(select 1 from atlas.farms f where f.id=p_farm_id) then
    raise exception 'Farm not found.' using errcode='22023';
  end if;
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  with relation_evidence as (
    select
      e.id,e.farm_id,
      nullif(e.metadata->>'contextCropCycleId','')::uuid context_crop_cycle_id,
      e.metadata->>'requirementKey' requirement_key,
      nullif(e.metadata->>'observedResult','') observed_result,
      e.evidence_date,e.created_at,
      e.metadata->>'witnessRole' witness_role,
      a.adjudication_state,
      a.id adjudication_id,
      a.created_at adjudicated_at
    from atlas.crop_occupancy_evidence e
    left join lateral (
      select x.id,x.adjudication_state,x.created_at
      from atlas.crop_relation_evidence_adjudications x
      where x.evidence_id=e.id
      order by x.created_at desc,x.id desc
      limit 1
    ) a on true
    where e.farm_id=p_farm_id and e.metadata->>'evidenceClass'='relation_witness'
  ), grouped as (
    select
      context_crop_cycle_id,requirement_key,
      count(*)::integer evidence_count,
      count(*) filter(where adjudication_id is null)::integer pending_evidence_count,
      count(*) filter(where adjudication_state='conflict_unresolved')::integer unresolved_conflict_count,
      count(distinct observed_result) filter(
        where observed_result in ('present','absent')
          and coalesce(adjudication_state,'pending') not in ('rejected_insufficient','superseded')
      )::integer effective_decisive_result_count,
      coalesce(jsonb_agg(distinct to_jsonb(observed_result)) filter(where observed_result is not null),'[]'::jsonb) observed_results,
      max(created_at) latest_evidence_at,
      max(adjudicated_at) latest_adjudication_at
    from relation_evidence
    group by context_crop_cycle_id,requirement_key
  ), decorated as (
    select g.*,
      c.crop_label context_crop_label,
      c.variety context_variety,
      case when g.effective_decisive_result_count>1 or g.unresolved_conflict_count>0 then true else false end has_conflict
    from grouped g
    left join atlas.crop_cycles c on c.id=g.context_crop_cycle_id
  )
  select
    (select count(*)::integer from relation_evidence),
    (select count(*)::integer from decorated where has_conflict),
    (select count(*)::integer from decorated where not has_conflict and pending_evidence_count>0),
    (select coalesce(jsonb_agg(jsonb_build_object(
      'contextCropCycleId',context_crop_cycle_id,'contextCropLabel',context_crop_label,'contextVariety',context_variety,
      'requirementKey',requirement_key,'evidenceCount',evidence_count,'pendingEvidenceCount',pending_evidence_count,
      'observedResults',observed_results,'latestEvidenceAt',latest_evidence_at
    ) order by latest_evidence_at,context_crop_cycle_id,requirement_key),'[]'::jsonb)
      from decorated where not has_conflict and pending_evidence_count>0),
    (select coalesce(jsonb_agg(jsonb_build_object(
      'contextCropCycleId',context_crop_cycle_id,'contextCropLabel',context_crop_label,'contextVariety',context_variety,
      'requirementKey',requirement_key,'evidenceCount',evidence_count,'pendingEvidenceCount',pending_evidence_count,
      'unresolvedConflictCount',unresolved_conflict_count,'observedResults',observed_results,
      'latestEvidenceAt',latest_evidence_at,'latestAdjudicationAt',latest_adjudication_at
    ) order by latest_evidence_at,context_crop_cycle_id,requirement_key),'[]'::jsonb)
      from decorated where has_conflict)
  into v_evidence_count,v_conflict_count,v_pending_count,v_pending,v_conflicts;

  return jsonb_build_object(
    'contractVersion','farm_relation_evidence_continuity_v1',
    'farmId',p_farm_id,'asOfDate',v_day,
    'state',case when v_conflict_count>0 then 'relation_evidence_conflict_requires_adjudication' when v_pending_count>0 then 'relation_evidence_pending_adjudication' else 'relation_evidence_continuity_sound' end,
    'summary',jsonb_build_object('relationWitnessEvidenceCount',v_evidence_count,'pendingRequirementCount',v_pending_count,'conflictingRequirementCount',v_conflict_count),
    'issueFamilies',jsonb_build_array(
      jsonb_build_object('key','conflicting_relation_witness_evidence','severity','high','count',v_conflict_count,'items',v_conflicts),
      jsonb_build_object('key','relation_witness_evidence_pending_adjudication','severity','medium','count',v_pending_count,'items',v_pending)
    ),
    'adjudication',jsonb_build_object(
      'jurisdiction','owner','function','farm_operations_continuity','actionKey','adjudicate_relation_witness_evidence',
      'authoringEndpoint','atlas.record_crop_relation_evidence_adjudication_v1(uuid,text,text,jsonb,text)'
    ),
    'truthBoundary',jsonb_build_object(
      'witnessEvidencePersistenceIsNotAdjudication',true,
      'witnessRoleDoesNotTransferMutationAuthority',true,
      'pendingEvidenceMustReceiveDurableCustody',true,
      'conflictIsPreservedUntilAdjudicated',true,
      'adjudicationDoesNotAutoMutateCropTruth',true,
      'principalEscalationCreated',false
    )
  );
end;
$function$;

revoke all on function atlas.farm_relation_evidence_continuity_v1(uuid,date) from public, anon, authenticated;

create or replace function atlas.bell_relation_evidence_repair_packets_v1(
  p_farm_id uuid,
  p_as_of_date date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_date date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_audit jsonb;
  v_family jsonb;
  v_packets jsonb:='[]'::jsonb;
  v_key text;
  v_count integer;
  v_severity text;
  v_items jsonb;
  v_fingerprint text;
begin
  v_audit:=atlas.farm_relation_evidence_continuity_v1(p_farm_id,v_date);
  for v_family in select value from jsonb_array_elements(coalesce(v_audit->'issueFamilies','[]'::jsonb)) loop
    v_key:=v_family->>'key';
    v_count:=coalesce((v_family->>'count')::integer,0);
    if v_count<=0 then continue; end if;
    v_severity:=coalesce(v_family->>'severity','medium');
    v_items:=coalesce(v_family->'items','[]'::jsonb);
    v_fingerprint:=md5(concat_ws('|',v_key,v_count::text,v_items::text));

    v_packets:=v_packets||jsonb_build_array(jsonb_build_object(
      'contractVersion','bell_relation_evidence_repair_packet_v1',
      'repairKey','relation_evidence:'||v_key,
      'fingerprint',v_fingerprint,
      'source',jsonb_build_object('kind','farm_relation_evidence_continuity','contractVersion',v_audit->>'contractVersion','issueFamily',v_key,'asOfDate',v_date),
      'divergenceClass',case when v_key='conflicting_relation_witness_evidence' then 'witness_conflict' else 'witness_custody' end,
      'severity',v_severity,'itemCount',v_count,
      'title',case when v_key='conflicting_relation_witness_evidence' then 'Adjudicate conflicting crop-relation witness evidence' else 'Adjudicate crop-relation witness evidence' end,
      'observedTruth',case when v_key='conflicting_relation_witness_evidence' then 'Neutral crop-relation evidence contains an unresolved contradiction or an explicit unresolved-conflict adjudication.' else 'Neutral crop-relation evidence has entered Atlas but has not yet received an owner adjudication.' end,
      'expectedTruth','Every received witness claim remains preserved as evidence and receives explicit adjudication custody before it can disappear into passive storage.',
      'differenceSummary','Witness evidence exists without completed adjudication custody.',
      'consequence','A human can truthfully report physical reality and Atlas can preserve the report, yet the institution can still fail to decide what represented state, if any, should change.',
      'owningFunction',jsonb_build_object('domain','farm_operations_continuity','function','adjudicate_relation_witness_evidence','jurisdiction','owner'),
      'repairRoute',jsonb_build_object('surface','bell','recipientFunction','farm_operations_continuity','humanActionRequired',true,'authoringEndpoint','atlas.record_crop_relation_evidence_adjudication_v1(uuid,text,text,jsonb,text)'),
      'workerResponsibility',jsonb_build_object('state','not_assigned_by_witness','principle','Submitting a witness observation establishes evidence, not fault, management responsibility, or mutation authority.'),
      'sampleItems',v_items,
      'drilldown',jsonb_build_object('function','atlas.farm_relation_evidence_continuity_v1','issueFamily',v_key,'asOfDate',v_date),
      'truthBoundary',jsonb_build_object('witnessIsNotAdjudicator',true,'adjudicationIsSeparateFromDomainMutation',true,'principalEscalationNotCreated',true)
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','bell_relation_evidence_repair_packets_v1','farmId',p_farm_id,'asOfDate',v_date,
    'state',case when jsonb_array_length(v_packets)>0 then 'relation_evidence_repair_required' else 'no_relation_evidence_repair_required' end,
    'packetCount',jsonb_array_length(v_packets),'packets',v_packets,
    'continuity',v_audit,
    'truthBoundary',jsonb_build_object('relationWitnessEvidenceCannotRemainUnownedAfterIntake',true,'principalEscalationCreated',false)
  );
end;
$function$;

revoke all on function atlas.bell_relation_evidence_repair_packets_v1(uuid,date) from public, anon, authenticated;

create or replace function atlas.bell_repair_packets_v3(p_farm_id uuid,p_as_of_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_date date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_base jsonb;
  v_relation jsonb;
  v_packets jsonb;
begin
  v_base:=atlas.bell_repair_packets_v2(p_farm_id,v_date);
  v_relation:=atlas.bell_relation_evidence_repair_packets_v1(p_farm_id,v_date);
  v_packets:=coalesce(v_base->'packets','[]'::jsonb)||coalesce(v_relation->'packets','[]'::jsonb);
  return v_base||jsonb_build_object(
    'contractVersion','bell_repair_packets_v3',
    'state',case when jsonb_array_length(v_packets)>0 then 'repair_divergences_present' else 'no_repair_divergence_detected' end,
    'packetCount',jsonb_array_length(v_packets),'packets',v_packets,
    'relationEvidenceContinuity',v_relation->'continuity',
    'truthBoundary',coalesce(v_base->'truthBoundary','{}'::jsonb)||jsonb_build_object('relationWitnessEvidenceHasAdjudicationCustody',true,'relationEvidenceRepairDoesNotCreatePrincipalWork',true)
  );
end;
$function$;

revoke all on function atlas.bell_repair_packets_v3(uuid,date) from public, anon, authenticated;

create or replace function atlas.sync_bell_repair_events_v2(p_farm_id uuid,p_as_of_date date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_date date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_org uuid;
  v_packet_set jsonb;
  v_packet jsonb;
  v_event_key text;
  v_event_id uuid;
  v_existing record;
  v_current_keys text[]:=array[]::text[];
  v_created integer:=0;
  v_changed integer:=0;
  v_unchanged integer:=0;
  v_resolved integer:=0;
  v_reset_receipts integer:=0;
  v_rows integer:=0;
begin
  select f.organization_id into v_org from atlas.farms f where f.id=p_farm_id;
  if v_org is null then raise exception 'Farm not found.' using errcode='22023'; end if;
  v_packet_set:=atlas.bell_repair_packets_v3(p_farm_id,v_date);

  for v_packet in select value from jsonb_array_elements(coalesce(v_packet_set->'packets','[]'::jsonb)) loop
    v_event_key:='reality_repair:'||coalesce(v_packet->>'repairKey','unclassified');
    v_current_keys:=array_append(v_current_keys,v_event_key);
    select e.id,e.source_event,e.payload->>'fingerprint' as fingerprint into v_existing
    from atlas.journal_event_index e
    where e.farm_id=p_farm_id and e.event_key=v_event_key limit 1;

    if v_existing.id is not null and v_existing.source_event='repair_required'
       and v_existing.fingerprint=coalesce(v_packet->>'fingerprint','') then
      v_unchanged:=v_unchanged+1;
      continue;
    end if;

    v_event_id:=atlas.upsert_journal_event_v1(
      v_org,p_farm_id,v_event_key,'system_event','reality_repair',p_farm_id,'repair_required',
      now(),v_date,coalesce(v_packet->>'title','Repair reality divergence'),
      concat_ws(' ',nullif(v_packet->>'differenceSummary',''),nullif(v_packet->>'consequence','')),
      'management','attention',null,null,null,null,null,null,null,
      v_packet||jsonb_build_object('repairState','open'),
      jsonb_build_object('contractVersion','bell_repair_routing_v2','packetContract',v_packet->>'contractVersion','syncedAt',now()),null
    );

    if v_existing.id is null then v_created:=v_created+1;
    else
      v_changed:=v_changed+1;
      update atlas.bell_event_receipts r set read_at=null,acknowledged_at=null,updated_at=now() where r.journal_event_id=v_event_id;
      get diagnostics v_rows=row_count;
      v_reset_receipts:=v_reset_receipts+v_rows;
    end if;
  end loop;

  update atlas.journal_event_index e
  set source_event='repair_resolved',importance='normal',occurred_at=now(),journal_date=v_date,
      payload=coalesce(e.payload,'{}'::jsonb)||jsonb_build_object('repairState','resolved','resolvedAt',now()),
      provenance=coalesce(e.provenance,'{}'::jsonb)||jsonb_build_object('resolvedBy','atlas.sync_bell_repair_events_v2','resolvedAt',now()),updated_at=now()
  where e.farm_id=p_farm_id and e.source_kind='reality_repair' and e.source_event='repair_required'
    and not (e.event_key=any(v_current_keys));
  get diagnostics v_resolved=row_count;

  return jsonb_build_object(
    'contractVersion','sync_bell_repair_events_v2','farmId',p_farm_id,'asOfDate',v_date,
    'activeRepairCount',coalesce((v_packet_set->>'packetCount')::integer,0),'created',v_created,
    'materiallyChangedOrReopened',v_changed,'unchanged',v_unchanged,'resolved',v_resolved,'receiptStatesReset',v_reset_receipts,
    'truthBoundary',jsonb_build_object('unchangedRepairDoesNotCreateNewBellNoise',true,'materialChangeMayReopenUnreadAttention',true,'resolvedDivergenceLeavesCurrentAttention',true,'syncDoesNotAssignWorkerBlame',true,'syncDoesNotCreatePrincipalWork',true,'relationWitnessEvidenceIncluded',true)
  );
end;
$function$;

revoke all on function atlas.sync_bell_repair_events_v2(uuid,date) from public, anon, authenticated;

create or replace function atlas.sync_bell_repair_events_v1(p_farm_id uuid,p_as_of_date date default null)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
  select atlas.sync_bell_repair_events_v2(p_farm_id,p_as_of_date);
$function$;

revoke all on function atlas.sync_bell_repair_events_v1(uuid,date) from public, anon, authenticated;