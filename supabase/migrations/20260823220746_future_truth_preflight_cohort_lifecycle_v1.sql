create or replace function atlas.crop_cycle_future_transplant_preflight_v1(
  p_crop_cycle_id uuid,
  p_as_of_date date default null,
  p_horizon_days integer default 42,
  p_acquisition_lead_days integer default 14
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_day date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_occ atlas.planned_work_occurrences%rowtype;
  v_work_date date;
  v_destination jsonb;
  v_targets jsonb:='[]'::jsonb;
  v_target_count integer:=0;
  v_preflight_due boolean:=false;
  v_current_requirement_active boolean:=false;
  v_member_ids uuid[]:=array[]::uuid[];
  v_member_ids_json jsonb:='[]'::jsonb;
  v_representative uuid;
begin
  if p_crop_cycle_id is null then raise exception 'Crop cycle is required.' using errcode='22023'; end if;
  if p_horizon_days<1 or p_horizon_days>180 then raise exception 'Future truth horizon must be between 1 and 180 days.' using errcode='22023'; end if;
  if p_acquisition_lead_days<0 or p_acquisition_lead_days>p_horizon_days then raise exception 'Acquisition lead must be within the future truth horizon.' using errcode='22023'; end if;

  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;

  select pwo.* into v_occ
  from atlas.planned_work_occurrences pwo
  where pwo.farm_id=v_cycle.farm_id
    and pwo.state in ('planned','eligible','released')
    and coalesce(pwo.planned_due_date,pwo.earliest_lawful_date,pwo.preferred_start_date) between v_day and v_day+p_horizon_days
    and coalesce(pwo.task_payload->>'task_type','')='transplanting'
    and (
      exists (
        select 1 from jsonb_array_elements_text(
          case when jsonb_typeof(pwo.task_payload->'metadata'->'crop_cycle_ids')='array' then pwo.task_payload->'metadata'->'crop_cycle_ids' else '[]'::jsonb end
        ) x(value) where x.value=v_cycle.id::text
      )
      or exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(pwo.relation_payload->'task_crop_cycles')='array' then pwo.relation_payload->'task_crop_cycles' else '[]'::jsonb end
        ) x(value) where x.value->>'crop_cycle_id'=v_cycle.id::text
      )
    )
  order by coalesce(pwo.planned_due_date,pwo.earliest_lawful_date,pwo.preferred_start_date),pwo.created_at,pwo.id
  limit 1;

  if v_occ.id is null then
    return jsonb_build_object(
      'contractVersion','crop_cycle_future_transplant_preflight_v2','cropCycleId',v_cycle.id,'futureOperationPlanned',false,
      'horizonDays',p_horizon_days,'acquisitionLeadDays',p_acquisition_lead_days,'asOfDate',v_day,
      'truthBoundary',jsonb_build_object('noFutureOccurrenceDoesNotCreateRequirement',true,'planningEvidenceDoesNotBecomeCurrentFarmState',true)
    );
  end if;

  v_work_date:=coalesce(v_occ.planned_due_date,v_occ.earliest_lawful_date,v_occ.preferred_start_date);
  v_destination:=atlas.crop_destination_claim_coverage_v1(v_cycle.id);
  v_current_requirement_active:=coalesce(v_cycle.lifecycle_status,'active')='active' and v_cycle.cycle_state='hardening_off' and v_cycle.planted_date is null;

  with raw_members as (
    select nullif(x.value,'')::uuid as crop_cycle_id
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_occ.task_payload->'metadata'->'crop_cycle_ids')='array' then v_occ.task_payload->'metadata'->'crop_cycle_ids' else '[]'::jsonb end
    ) x(value)
    union
    select nullif(x.value->>'crop_cycle_id','')::uuid
    from jsonb_array_elements(
      case when jsonb_typeof(v_occ.relation_payload->'task_crop_cycles')='array' then v_occ.relation_payload->'task_crop_cycles' else '[]'::jsonb end
    ) x(value)
  ), valid_members as (
    select distinct cc.id
    from raw_members rm
    join atlas.crop_cycles cc on cc.id=rm.crop_cycle_id and cc.farm_id=v_cycle.farm_id
  )
  select coalesce(array_agg(id order by id),array[v_cycle.id]::uuid[]),
         coalesce(jsonb_agg(id order by id),jsonb_build_array(v_cycle.id)),
         coalesce((array_agg(id order by id))[1],v_cycle.id)
    into v_member_ids,v_member_ids_json,v_representative
  from valid_members;

  if cardinality(v_member_ids)=0 then
    v_member_ids:=array[v_cycle.id];
    v_member_ids_json:=jsonb_build_array(v_cycle.id);
    v_representative:=v_cycle.id;
  end if;

  with raw_candidates as (
    select nullif(x.value->>'object_id','')::uuid as object_id,'planned_work_relation'::text as source
    from jsonb_array_elements(
      case when jsonb_typeof(v_occ.relation_payload->'task_objects')='array' then v_occ.relation_payload->'task_objects' else '[]'::jsonb end
    ) x(value)
    where x.value->>'role'='target'
    union all
    select nullif(x.value,'')::uuid,'task_payload_metadata'::text
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_occ.task_payload->'metadata'->'target_object_ids')='array' then v_occ.task_payload->'metadata'->'target_object_ids' else '[]'::jsonb end
    ) x(value)
  ), grouped as (
    select rc.object_id,coalesce(jsonb_agg(distinct rc.source) filter(where rc.source is not null),'[]'::jsonb) as sources
    from raw_candidates rc
    where rc.object_id is not null
    group by rc.object_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('objectId',g.object_id,'label',go.label,'stableKey',go.stable_key,'sources',g.sources) order by go.sort_order nulls last,go.label,g.object_id),'[]'::jsonb),
         count(*)::integer
    into v_targets,v_target_count
  from grouped g
  left join atlas.growing_objects go on go.id=g.object_id and go.farm_id=v_cycle.farm_id;

  v_preflight_due:=not v_current_requirement_active
    and coalesce(v_destination->>'coverageState','missing')='missing'
    and v_work_date<=v_day+p_acquisition_lead_days
    and v_cycle.id=v_representative;

  return jsonb_build_object(
    'contractVersion','crop_cycle_future_transplant_preflight_v2','cropCycleId',v_cycle.id,
    'futureOperationPlanned',true,'futureOperationKind','transplant','futureOperationOccurrenceId',v_occ.id,'futureOperationDate',v_work_date,
    'futureOperationCropCycleIds',v_member_ids_json,'decisionRepresentativeCropCycleId',v_representative,
    'isDecisionRepresentative',(v_cycle.id=v_representative),
    'daysUntilOperation',v_work_date-v_day,'horizonDays',p_horizon_days,'acquisitionLeadDays',p_acquisition_lead_days,
    'acquisitionWindowOpensOn',v_work_date-p_acquisition_lead_days,'acquisitionWindowOpen',(v_work_date<=v_day+p_acquisition_lead_days),
    'currentTransplantRequirementActive',v_current_requirement_active,'destinationCoverageState',v_destination->>'coverageState',
    'destinationReleaseAllowed',coalesce((v_destination->>'spatialReleaseAllowed')::boolean,false),
    'transplantDestinationPreflightDue',v_preflight_due,'possibleTargetEvidence',v_targets,'possibleTargetEvidenceCount',v_target_count,
    'truthBoundary',jsonb_build_object(
      'futureOccurrenceIsPlanningEvidenceNotCurrentRequirement',true,'plannedTargetObjectsAreEvidenceNotCanonicalDestinationTruth',true,
      'canonicalDestinationClaimsSuppressPreflightAsk',true,'currentRequirementSupersedesFuturePreflight',true,'schedulingDoesNotCreateOperationalTruth',true,
      'oneFutureOccurrenceCreatesOneOwnerDecision',true
    )
  );
end;$function$;

create or replace function atlas.record_future_transplant_destination_cohort_v1(
  p_instance_id uuid,
  p_destination_object_id uuid,
  p_owner_membership_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_instance atlas.state_consequence_instances%rowtype;
  v_destination atlas.growing_objects%rowtype;
  v_cycle_id uuid;
  v_member_ids uuid[]:=array[]::uuid[];
  v_required_by date;
  v_write jsonb;
  v_writes jsonb:='[]'::jsonb;
  v_claim_id uuid;
begin
  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id for update;
  if v_instance.id is null then raise exception 'Knowledge acquisition question was not found.' using errcode='P0002'; end if;
  if v_instance.subject_kind<>'crop_cycle' or coalesce(v_instance.epistemic_basis->>'acquisitionPhase','')<>'future_preflight' then
    raise exception 'Future transplant cohort write requires a future-preflight crop-cycle question.' using errcode='22023';
  end if;
  select * into v_destination from atlas.growing_objects where id=p_destination_object_id and farm_id=v_instance.farm_id;
  if v_destination.id is null then raise exception 'Destination object must belong to the same farm as the question.' using errcode='22023'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_owner_membership_id and fm.farm_id=v_instance.farm_id and fm.active and fm.role='owner') then
    raise exception 'Active Owner membership is required.' using errcode='42501';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'Idempotency key is required.' using errcode='22023'; end if;

  select coalesce(array_agg(distinct x.value::uuid order by x.value::uuid),array[v_instance.subject_id]::uuid[])
    into v_member_ids
  from jsonb_array_elements_text(
    case when jsonb_typeof(v_instance.state_snapshot->'futureTruthPreflight'->'futureOperationCropCycleIds')='array'
         then v_instance.state_snapshot->'futureTruthPreflight'->'futureOperationCropCycleIds'
         else jsonb_build_array(v_instance.subject_id) end
  ) x(value)
  join atlas.crop_cycles cc on cc.id=x.value::uuid and cc.farm_id=v_instance.farm_id;

  begin v_required_by:=nullif(v_instance.state_snapshot->'futureTruthPreflight'->>'futureOperationDate','')::date; exception when others then v_required_by:=null; end;
  v_required_by:=coalesce(v_required_by,(now() at time zone 'America/Chicago')::date);

  foreach v_cycle_id in array v_member_ids loop
    v_write:=atlas.record_crop_destination_claim_v1(
      v_cycle_id,v_destination.id,null,null,v_required_by,'committed','principal','Owner answered Atlas Needs From You future preflight.',v_instance.carrier_task_id,
      'owner_knowledge_acquisition',
      jsonb_build_object('stateConsequenceInstanceId',v_instance.id,'ownerMembershipId',p_owner_membership_id,'answerKind','choose_destination',
        'acquisitionPhase','future_preflight','futureOperationOccurrenceId',v_instance.state_snapshot->'futureTruthPreflight'->>'futureOperationOccurrenceId',
        'futureOperationDate',v_instance.state_snapshot->'futureTruthPreflight'->>'futureOperationDate','cohortDecision',true,'answeredAt',now()),
      left(btrim(p_idempotency_key)||':'||v_cycle_id::text,240)
    );
    v_claim_id:=nullif(v_write->>'claimId','')::uuid;
    if v_claim_id is not null then
      update atlas.crop_destination_claims
      set recorded_by_membership_id=p_owner_membership_id,
          source_evidence=coalesce(source_evidence,'{}'::jsonb)||jsonb_build_object('ownerMembershipId',p_owner_membership_id,'source','atlas_needs_from_you','acquisitionPhase','future_preflight','cohortDecision',true),
          updated_at=now()
      where id=v_claim_id;
    end if;
    perform atlas.reconcile_crop_cycle_requirement_state_v1(v_cycle_id);
    v_writes:=v_writes||jsonb_build_array(jsonb_build_object('cropCycleId',v_cycle_id,'canonicalWrite',v_write));
  end loop;

  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id;
  if v_instance.status<>'resolved' then raise exception 'Future-preflight destination cohort was recorded but the acquisition consequence did not resolve; transaction rolled back.' using errcode='P0001'; end if;

  return jsonb_build_object('contractVersion','record_future_transplant_destination_cohort_v1','instanceId',p_instance_id,
    'destinationObjectId',p_destination_object_id,'cropCycleIds',to_jsonb(v_member_ids),'writes',v_writes,
    'truthBoundary',jsonb_build_object('answerOncePropagatesAcrossFutureOccurrenceCohort',true,'plannedOccurrenceDoesNotBecomeCanonicalTruth',true,'transactionFailsIfPropagationFails',true));
end;$function$;

revoke all on function atlas.record_future_transplant_destination_cohort_v1(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function atlas.record_future_transplant_destination_cohort_v1(uuid,uuid,uuid,text) to service_role;

create or replace function atlas.answer_owner_needs_from_you_v1(p_instance_id uuid, p_answer_kind text, p_destination_object_id uuid default null, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer
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
  v_required_by date;
  v_acquisition_phase text;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  if p_instance_id is null or nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'Question instance and idempotency key are required.' using errcode='22023'; end if;
  if v_answer_kind not in ('choose_destination','i_do_not_know') then raise exception 'Unsupported owner knowledge answer kind.' using errcode='22023'; end if;

  select * into v_instance from atlas.state_consequence_instances where id=p_instance_id for update;
  if v_instance.id is null then raise exception 'Knowledge acquisition question was not found.' using errcode='P0002'; end if;
  select * into v_member from atlas.farm_memberships where farm_id=v_instance.farm_id and user_id=v_user_id and active and role='owner' order by created_at limit 1;
  if v_member.id is null then raise exception 'Active Owner membership is required for this question.' using errcode='42501'; end if;

  if v_instance.status<>'open' or v_instance.consequence_role<>'truth_acquisition' then
    return jsonb_build_object('contractVersion','answer_owner_needs_from_you_v1','instanceId',v_instance.id,'state','already_resolved','status',v_instance.status,'idempotent',true);
  end if;
  v_knower:=atlas.truth_acquisition_knower_v1(v_instance.id);
  if v_knower->>'acquisitionSurface'<>'atlas_needs_from_you' then raise exception 'This unresolved fact is not currently assigned to Atlas Needs From You.' using errcode='22023'; end if;

  if v_answer_kind='i_do_not_know' then
    update atlas.state_consequence_instances
    set epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
          'ownerKnowledgeResponse',jsonb_build_object('kind','i_do_not_know','membershipId',v_member.id,'answeredAt',now(),'releaseGeneration',release_generation,'idempotencyKey',btrim(p_idempotency_key)),
          'knowerClass','actually_unknown','acquisitionSurface','unresolved_unknown','classifiedBy','owner_needs_from_you_answer_v1'),updated_at=now()
    where id=v_instance.id;
    if v_instance.carrier_task_id is not null and exists(select 1 from atlas.tasks where id=v_instance.carrier_task_id and status in ('open','blocked')) then
      v_transition:=atlas.record_task_transition_v1_internal(
        v_instance.carrier_task_id,'done',left('owner-does-not-know:'||v_instance.id::text||':'||v_instance.release_generation::text,160),null,
        'Owner answered I don''t know. The missing fact remains unresolved and is no longer assigned to the Owner queue.',
        'owner_knowledge_response','truth_acquisition',v_instance.action_key,
        jsonb_build_object('completion_source','owner_not_knower','state_consequence_instance_id',v_instance.id,'source_requirement_instance_id',v_instance.source_requirement_instance_id,'answered_by_membership_id',v_member.id,'fact_resolved',false),null);
    end if;
    select * into v_after from atlas.state_consequence_instances where id=v_instance.id;
    return jsonb_build_object('contractVersion','answer_owner_needs_from_you_v1','instanceId',v_after.id,'state','owner_not_knower','factResolved',false,'questionStatus',v_after.status,
      'knower',atlas.truth_acquisition_knower_v1(v_after.id),'carrierTransition',v_transition,
      'truthBoundary',jsonb_build_object('unknownRemainsUnknown',true,'sourceRequirementRemainsIndependent',true,'ownerQueueAssignmentRemovedWithoutInventingFact',true));
  end if;

  if v_instance.action_key<>'choose_transplant_destination' or v_instance.subject_kind<>'crop_cycle' then raise exception 'Destination answers are only supported for crop-cycle transplant destination questions.' using errcode='22023'; end if;
  if p_destination_object_id is null then raise exception 'Destination object is required.' using errcode='22023'; end if;
  select * into v_destination from atlas.growing_objects where id=p_destination_object_id;
  if v_destination.id is null or v_destination.farm_id is distinct from v_instance.farm_id then raise exception 'Destination object must belong to the same farm as the question.' using errcode='22023'; end if;

  v_acquisition_phase:=coalesce(v_instance.epistemic_basis->>'acquisitionPhase','active_requirement');
  begin v_required_by:=nullif(v_instance.state_snapshot->'futureTruthPreflight'->>'futureOperationDate','')::date; exception when others then v_required_by:=null; end;
  v_required_by:=coalesce(v_instance.requirement_known_active_by,v_required_by,(now() at time zone 'America/Chicago')::date);

  if v_acquisition_phase='future_preflight' then
    v_write:=atlas.record_future_transplant_destination_cohort_v1(v_instance.id,v_destination.id,v_member.id,btrim(p_idempotency_key));
  else
    v_write:=atlas.record_crop_destination_claim_v1(
      v_instance.subject_id,v_destination.id,null,null,v_required_by,'committed','principal','Owner answered Atlas Needs From You.',v_instance.carrier_task_id,
      'owner_knowledge_acquisition',
      jsonb_build_object('stateConsequenceInstanceId',v_instance.id,'sourceRequirementInstanceId',v_instance.source_requirement_instance_id,'ownerMembershipId',v_member.id,
        'answerKind','choose_destination','acquisitionPhase',v_acquisition_phase,'futureOperationDate',v_instance.state_snapshot->'futureTruthPreflight'->>'futureOperationDate','answeredAt',now()),
      btrim(p_idempotency_key));
    v_claim_id:=nullif(v_write->>'claimId','')::uuid;
    if v_claim_id is not null then
      update atlas.crop_destination_claims
      set recorded_by_membership_id=v_member.id,
          source_evidence=coalesce(source_evidence,'{}'::jsonb)||jsonb_build_object('ownerMembershipId',v_member.id,'source','atlas_needs_from_you','acquisitionPhase',v_acquisition_phase),updated_at=now()
      where id=v_claim_id;
    end if;
    perform atlas.reconcile_crop_cycle_requirement_state_v1(v_instance.subject_id);
  end if;

  select * into v_after from atlas.state_consequence_instances where id=v_instance.id;
  if v_after.status<>'resolved' then raise exception 'Canonical destination was recorded but the acquisition consequence did not resolve; transaction rolled back.' using errcode='P0001'; end if;
  if v_after.source_requirement_instance_id is not null then select status into v_source_status from atlas.state_consequence_instances where id=v_after.source_requirement_instance_id; end if;

  return jsonb_build_object('contractVersion','answer_owner_needs_from_you_v2','instanceId',v_after.id,'state','canonical_answer_recorded','factResolved',true,'answerKind','choose_destination',
    'destinationObject',jsonb_build_object('id',v_destination.id,'label',v_destination.label,'stableKey',v_destination.stable_key),'canonicalWrite',v_write,
    'questionStatus',v_after.status,'sourceRequirementStatus',v_source_status,'resolutionContinuation',v_after.epistemic_basis->'resolutionContinuation','acquisitionPhase',v_acquisition_phase,'requiredBy',v_required_by,
    'truthBoundary',jsonb_build_object('answerRecordedCanonically',true,'carrierTaskNotReality',true,'sourceRequirementRemainsIndependent',true,'futurePreflightUsesFutureOperationDate',true,'futurePreflightPropagatesAcrossOccurrenceCohort',true,'transactionFailsIfPropagationFails',true));
end;$function$;

create or replace function atlas.future_truth_preflight_tick_v1(p_as_of_date date default null)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_day date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_cycle record;
  v_snapshot jsonb;
  v_result jsonb;
  v_results jsonb:='[]'::jsonb;
  v_evaluated integer:=0;
  v_opened_or_refreshed integer:=0;
  v_failed integer:=0;
begin
  for v_cycle in
    select cc.id
    from atlas.crop_cycles cc
    where coalesce(cc.lifecycle_status,'active')='active'
      and (
        coalesce((atlas.crop_cycle_future_transplant_preflight_v1(cc.id,v_day,42,14)->>'futureOperationPlanned')::boolean,false)
        or exists (
          select 1 from atlas.state_consequence_instances i
          join atlas.state_consequence_policies p on p.id=i.policy_id
          where i.subject_kind='crop_cycle' and i.subject_id=cc.id and i.status='open'
            and p.stable_key='crop-future-transplant-destination-truth-preflight-v1'
        )
      )
    order by cc.id
  loop
    begin
      v_snapshot:=atlas.state_consequence_snapshot_v1('crop_cycle',v_cycle.id);
      v_result:=atlas.reconcile_state_consequences_v1('crop_cycle',v_cycle.id);
      v_evaluated:=v_evaluated+1;
      if coalesce((v_snapshot->'futureTruthPreflight'->>'transplantDestinationPreflightDue')::boolean,false) then
        v_opened_or_refreshed:=v_opened_or_refreshed+1;
      end if;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('cropCycleId',v_cycle.id,'state','reconciled','futureTruthPreflight',v_snapshot->'futureTruthPreflight'));
    exception when others then
      v_failed:=v_failed+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('cropCycleId',v_cycle.id,'state','failed','sqlstate',sqlstate,'message',sqlerrm));
    end;
  end loop;
  return jsonb_build_object('contractVersion','future_truth_preflight_tick_v1','asOfDate',v_day,'evaluatedCropCycleCount',v_evaluated,
    'preflightDueCount',v_opened_or_refreshed,'failedCount',v_failed,'results',v_results,
    'truthBoundary',jsonb_build_object('futurePlanningEvidenceDoesNotCreateCurrentRequirement',true,'canonicalConsequenceReconcilerOwnsOpenAndClose',true,'oneFutureOccurrenceCreatesOneOwnerDecision',true));
end;$function$;

revoke all on function atlas.future_truth_preflight_tick_v1(date) from public,anon,authenticated;
grant execute on function atlas.future_truth_preflight_tick_v1(date) to service_role;

do $do$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    if exists(select 1 from cron.job where jobname='atlas-future-truth-preflight-v1') then
      perform cron.unschedule(jobid) from cron.job where jobname='atlas-future-truth-preflight-v1';
    end if;
    perform cron.schedule('atlas-future-truth-preflight-v1','41 * * * *','select atlas.future_truth_preflight_tick_v1();');
  end if;
end;$do$;