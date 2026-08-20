create or replace function atlas.crop_harvest_commercial_target_state_v1(p_crop_cycle_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog','atlas','auth' as $function$
declare v_cycle atlas.crop_cycles%rowtype; v_count integer:=0; v_targets jsonb:='[]'::jsonb; v_relevant boolean:=false;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_cycle.farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  v_relevant:=exists(select 1 from atlas.crop_harvest_availability a where a.crop_cycle_id=v_cycle.id and a.status='harvestable') or v_cycle.harvest_started_date is not null;
  select count(*)::integer,coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'demandOrderId',d.demand_order_id,'demandLineId',d.demand_line_id,'buyerRelationshipId',d.buyer_relationship_id,
    'customerLabel',d.customer_label,'salesChannel',d.sales_channel,'requestedForDate',d.requested_for_date,
    'demandStrength',d.demand_strength,'inventoryKind',d.inventory_kind,'cropProfileId',d.crop_profile_id,
    'productLabel',d.product_label,'quantity',d.quantity,'unit',d.unit
  )) order by d.requested_for_date nulls last,d.created_at,d.demand_line_id),'[]'::jsonb)
  into v_count,v_targets
  from atlas.flower_demand_line_position_v1 d
  where d.farm_id=v_cycle.farm_id and d.demand_state='open' and (
    (v_cycle.crop_profile_id is not null and d.crop_profile_id=v_cycle.crop_profile_id)
    or (v_cycle.crop_profile_id is null and d.product_label is not null and btrim(d.product_label)<>'' and
      lower(regexp_replace(btrim(d.product_label),'\s+',' ','g')) in (
        lower(regexp_replace(btrim(coalesce(v_cycle.variety,'')),'\s+',' ','g')),
        lower(regexp_replace(btrim(coalesce(v_cycle.crop_label,'')),'\s+',' ','g'))))
  );
  return jsonb_build_object('contractVersion','crop_harvest_commercial_target_state_v1','cropCycleId',v_cycle.id,
    'relevant',v_relevant,'state',case when not v_relevant then 'not_yet_relevant' when v_count>0 then 'target_established' else 'decision_required' end,
    'targetCount',v_count,'targets',v_targets,'truthBoundary',jsonb_build_object(
      'commercialTargetDoesNotEstablishHarvestability',true,'commercialTargetDoesNotBlockBiologicalHarvest',true,
      'noOpenDemandIsACommercialDecisionGapNotProofOfNoFutureBuyer',true,'buyerAllocationAndHarvestRequirementAreIndependent',true));
end;$function$;
revoke all on function atlas.crop_harvest_commercial_target_state_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.crop_harvest_commercial_target_state_v1(uuid) to service_role;

create or replace function atlas.crop_cycle_requirement_snapshot_v1(p_crop_cycle_id uuid,p_as_of_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog','atlas','auth' as $function$
declare
  v_cycle atlas.crop_cycles%rowtype; v_day date:=coalesce(p_as_of_date,current_date); v_destination jsonb; v_commercial jsonb;
  v_availability atlas.crop_harvest_availability%rowtype; v_event atlas.crop_harvest_events%rowtype;
  v_profile_exists boolean:=false; v_transplant_required boolean:=false; v_harvest_required boolean:=false;
  v_first_witness_date date; v_hardening_started date; v_time_class text; v_onset date; v_known_active_by date;
  v_requirement_action text; v_requirement_state text; v_epistemic jsonb:='{}'::jsonb;
begin
  if p_crop_cycle_id is null then raise exception 'Crop cycle is required.' using errcode='22023'; end if;
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_cycle.farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  v_profile_exists:=v_cycle.crop_profile_id is not null and exists(select 1 from atlas.crop_profiles cp where cp.id=v_cycle.crop_profile_id);
  v_destination:=atlas.crop_destination_claim_coverage_v1(v_cycle.id); v_commercial:=atlas.crop_harvest_commercial_target_state_v1(v_cycle.id);
  select * into v_availability from atlas.crop_harvest_availability where crop_cycle_id=v_cycle.id;
  if v_availability.source_event_id is not null then select * into v_event from atlas.crop_harvest_events where id=v_availability.source_event_id; end if;
  begin v_hardening_started:=nullif(v_cycle.metadata->>'hardening_started_date','')::date; exception when others then v_hardening_started:=null; end;
  begin v_first_witness_date:=nullif(v_cycle.metadata->>'current_state_witness_date','')::date; exception when others then v_first_witness_date:=null; end;
  v_first_witness_date:=coalesce(v_first_witness_date,(v_cycle.created_at at time zone 'America/Chicago')::date);
  v_transplant_required:=coalesce(v_cycle.lifecycle_status,'active')='active' and v_cycle.cycle_state='hardening_off' and v_cycle.planted_date is null;
  v_harvest_required:=coalesce(v_cycle.lifecycle_status,'active')='active' and v_availability.status='harvestable';
  if v_harvest_required then
    v_requirement_action:='harvest'; v_requirement_state:='due'; v_onset:=null;
    v_known_active_by:=coalesce(v_availability.observed_date,v_event.observed_date,v_day); v_time_class:='known_active_by';
    v_epistemic:=jsonb_strip_nulls(jsonb_build_object('basis','canonical_harvestability_observation','harvestAvailabilityStatus',v_availability.status,
      'harvestAvailabilityObservedDate',v_availability.observed_date,'harvestReadinessEventId',v_availability.source_event_id,
      'harvestReadinessEventDate',v_event.observed_date,'estimatedQuantity',v_availability.estimated_quantity,'estimatedUnit',v_availability.unit,
      'exactRequirementOnsetEstablished',false,'buyerAllocationRequiredToRecognizeHarvestNeed',false,'profileRequiredToRecognizeHarvestNeed',false,
      'principle','A witnessed harvestable body establishes a harvest response before commercial allocation is complete.'));
  elsif v_transplant_required then
    v_requirement_action:='transplant'; v_requirement_state:='due'; v_onset:=null; v_known_active_by:=v_first_witness_date; v_time_class:='known_active_by';
    v_epistemic:=jsonb_build_object('basis','current_canonical_state','witnessState','hardening_off','firstCurrentStateWitnessDate',v_first_witness_date,
      'hardeningStartedDate',v_hardening_started,'exactRequirementOnsetEstablished',false,'profileRequiredToRecognizeCurrentNeed',false,
      'openTaskRequiredToRecognizeCurrentNeed',false,'principle','Current living state may establish a required response even when historical timing/model detail is incomplete.');
  end if;
  return jsonb_strip_nulls(jsonb_build_object('contractVersion','crop_cycle_requirement_snapshot_v2','subjectKind','crop_cycle','subjectId',v_cycle.id,
    'farmId',v_cycle.farm_id,'cropCycleKey',v_cycle.crop_cycle_key,'cropLabel',v_cycle.crop_label,'variety',v_cycle.variety,
    'lifecycleStatus',v_cycle.lifecycle_status,'cycleState',v_cycle.cycle_state,'plantedDate',v_cycle.planted_date,
    'profilePresent',v_profile_exists,'cropProfileId',v_cycle.crop_profile_id,'currentLocation',v_cycle.metadata->>'current_location',
    'containerKind',v_cycle.metadata->>'container_kind','hardeningStartedDate',v_hardening_started,'firstCurrentStateWitnessDate',v_first_witness_date,
    'transplantResponseRequired',v_transplant_required,'harvestResponseRequired',v_harvest_required,'harvestAvailabilityStatus',v_availability.status,
    'harvestAvailabilityObservedDate',v_availability.observed_date,'harvestReadinessEventId',v_availability.source_event_id,
    'harvestCommercialTargetState',case when coalesce((v_commercial->>'relevant')::boolean,false) then v_commercial->>'state' end,
    'harvestCommercialTarget',v_commercial,'requirementOperationKey',v_requirement_action,'requirementState',v_requirement_state,
    'requirementOnsetDate',v_onset,'requirementKnownActiveBy',v_known_active_by,'requirementTimeClass',v_time_class,'requirementEpistemicBasis',v_epistemic,
    'destinationCoverageState',v_destination->>'coverageState','destinationReleaseAllowed',coalesce((v_destination->>'spatialReleaseAllowed')::boolean,false),
    'destination',v_destination,'asOfDate',v_day,'truthBoundary',jsonb_build_object('missingProfileDoesNotEraseCurrentRequirement',true,
      'openTaskDoesNotAutomaticallyCoverEveryRequirement',true,'hardeningStartIsNotAutomaticallyExactTransplantDueDate',true,
      'unknownDestinationDoesNotEraseTransplantRequirement',true,'harvestabilityCreatesRequirementBeforeBuyerAllocation',true,
      'unknownCommercialTargetDoesNotEraseOrBlockHarvestRequirement',true,'requirementClockAndExecutionWarrantAreIndependent',true)));
end;$function$;

insert into atlas.state_consequence_policies(stable_key,subject_kind,subject_selector,state_match,consequence_kind,action_key,audience,priority,action_spec,active,metadata)
values
('crop-harvest-response-required','crop_cycle','{}'::jsonb,jsonb_build_object('harvestResponseRequired',true),'operation_requirement','harvest','farm_operations',15,
 jsonb_build_object('state','operation_required','action','harvest','actionLabel','Harvest this crop','blocksExecution',false),true,
 jsonb_build_object('consequenceRole','operation_requirement','contract','requirement_truth_acquisition_execution_p9','requirementTimeSource','crop_cycle_requirement_snapshot_v1',
   'principle','Harvestability is source requirement truth; commercial allocation is a separate premise.')),
('crop-harvest-commercial-target-required','crop_cycle','{}'::jsonb,jsonb_build_object('harvestCommercialTargetState','decision_required'),'planning_resolution','choose_harvest_disposition','owner',20,
 jsonb_build_object('state','truth_acquisition_required','action','choose_harvest_disposition','actionLabel','Decide where this harvest is going',
   'factNeeded','buyer/channel/disposition target for the harvest','jurisdiction','owner','blocksExecution',false,'doesNotEraseRequirement',true),true,
 jsonb_build_object('consequenceRole','truth_acquisition','sourceRequirementPolicyKey','crop-harvest-response-required','jurisdiction','owner',
   'gapKind','commercial_target_required','blocking',false,'inheritsRequirementUrgency',true,'contract','requirement_truth_acquisition_execution_p9',
   'principle','Buyer/channel uncertainty becomes an Owner decision without blocking biological harvest.'))
on conflict(stable_key) do update set subject_kind=excluded.subject_kind,subject_selector=excluded.subject_selector,state_match=excluded.state_match,
 consequence_kind=excluded.consequence_kind,action_key=excluded.action_key,audience=excluded.audience,priority=excluded.priority,action_spec=excluded.action_spec,
 active=true,metadata=excluded.metadata,updated_at=now();

create or replace function atlas.crop_operation_execution_warrant_v1(p_crop_cycle_id uuid,p_operation_key text,p_requirement_instance_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog','atlas','auth' as $function$
declare v_cycle atlas.crop_cycles%rowtype; v_requirement atlas.state_consequence_instances%rowtype; v_destination jsonb; v_commercial jsonb;
 v_availability atlas.crop_harvest_availability%rowtype; v_gaps jsonb:='[]'::jsonb; v_nonblocking jsonb:='[]'::jsonb;
 v_operation text:=lower(btrim(coalesce(p_operation_key,''))); v_ready boolean:=false; v_warrant text;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_cycle.farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if v_operation='' then raise exception 'Operation key is required.' using errcode='22023'; end if;
  if p_requirement_instance_id is not null then
    select * into v_requirement from atlas.state_consequence_instances i where i.id=p_requirement_instance_id and i.subject_kind='crop_cycle'
      and i.subject_id=v_cycle.id and i.consequence_role='operation_requirement' and i.action_key=v_operation and i.status='open';
  else
    select * into v_requirement from atlas.state_consequence_instances i where i.subject_kind='crop_cycle' and i.subject_id=v_cycle.id
      and i.consequence_role='operation_requirement' and i.action_key=v_operation and i.status='open' order by i.priority,i.released_at,i.id limit 1;
  end if;
  if v_requirement.id is null then return jsonb_build_object('contractVersion','crop_operation_execution_warrant_v2','cropCycleId',v_cycle.id,
    'operationKey',v_operation,'requirementExists',false,'executionReady',false,'warrant','requirement_not_established','gaps','[]'::jsonb,
    'truthBoundary',jsonb_build_object('absenceOfRequirementIsNotExecutionReadiness',true)); end if;
  if v_operation='transplant' then
    v_destination:=atlas.crop_destination_claim_coverage_v1(v_cycle.id);
    if coalesce(v_destination->>'coverageState','missing')='missing' then
      v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('kind','destination_required','factNeeded','lawful transplant destination','jurisdiction','owner_or_manager',
        'evidenceToClose','an evidence-backed active crop destination claim','blocksExecution',true,'sourceRequirementInstanceId',v_requirement.id,'sourceRequirementAction',v_requirement.action_key));
    elsif not coalesce((v_destination->>'spatialReleaseAllowed')::boolean,false) then
      v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('kind','destination_coverage_required','factNeeded','sufficient destination coverage for the moving cohort',
        'jurisdiction','owner_or_manager','evidenceToClose','destination claim coverage sufficient under crop_destination_claim_coverage_v1','blocksExecution',true,'sourceRequirementInstanceId',v_requirement.id));
    end if;
    if v_cycle.crop_profile_id is null then v_nonblocking:=v_nonblocking||jsonb_build_array(jsonb_build_object('kind','crop_profile_source_missing','blocksExecution',false,
      'reason','The current hardening-off witness is sufficient to preserve the transplant requirement; profile repair remains separate model coverage.')); end if;
  elsif v_operation='harvest' then
    select * into v_availability from atlas.crop_harvest_availability where crop_cycle_id=v_cycle.id; v_commercial:=atlas.crop_harvest_commercial_target_state_v1(v_cycle.id);
    if coalesce(v_availability.status,'unknown')<>'harvestable' then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('kind','harvestability_not_current',
      'factNeeded','current harvestable crop state','evidenceToClose','a canonical harvest-readiness observation with status harvestable','jurisdiction','farm_operations',
      'blocksExecution',true,'sourceRequirementInstanceId',v_requirement.id)); end if;
    if coalesce(v_commercial->>'state','decision_required')='decision_required' then v_nonblocking:=v_nonblocking||jsonb_build_array(jsonb_build_object(
      'kind','commercial_target_required','factNeeded','buyer/channel/disposition target for this harvest','jurisdiction','owner',
      'evidenceToClose','an open independent flower demand line matching the crop','blocksExecution',false,'sourceRequirementInstanceId',v_requirement.id,
      'reason','The crop can require harvest before a buyer or sales channel is committed.')); end if;
    if v_cycle.crop_profile_id is null then v_nonblocking:=v_nonblocking||jsonb_build_array(jsonb_build_object('kind','crop_profile_source_missing','blocksExecution',false,
      'reason','A canonical harvestability observation is sufficient to require harvest; profile repair remains separate model coverage.')); end if;
  else return jsonb_build_object('contractVersion','crop_operation_execution_warrant_v2','cropCycleId',v_cycle.id,'operationKey',v_operation,
    'requirementExists',true,'requirementInstanceId',v_requirement.id,'executionReady',false,'warrant','unsupported_operation_adapter',
    'gaps',jsonb_build_array(jsonb_build_object('kind','operation_warrant_adapter_required','blocksExecution',true))); end if;
  v_ready:=jsonb_array_length(v_gaps)=0; v_warrant:=case when v_ready then 'ready' else 'missing_truth' end;
  return jsonb_build_object('contractVersion','crop_operation_execution_warrant_v2','cropCycleId',v_cycle.id,'operationKey',v_operation,
    'requirementExists',true,'requirementInstanceId',v_requirement.id,'requirementKnownActiveBy',v_requirement.requirement_known_active_by,
    'requirementOnsetDate',v_requirement.requirement_onset_date,'requirementTimeClass',v_requirement.requirement_time_class,
    'executionReady',v_ready,'warrant',v_warrant,'gaps',v_gaps,'nonBlockingUnknowns',v_nonblocking,'destination',v_destination,'commercialTarget',v_commercial,
    'truthBoundary',jsonb_build_object('requirementExistsIndependentlyOfExecutionWarrant',true,'missingDestinationBlocksExecutionNotRequirement',true,
      'missingProfileDoesNotAutomaticallyBlockCurrentResponse',true,'commercialTargetDoesNotBlockBiologicalHarvest',true,'warrantResolutionDoesNotResetRequirementTime',true));
end;$function$;
revoke all on function atlas.crop_operation_execution_warrant_v1(uuid,text,uuid) from public,anon,authenticated;
grant execute on function atlas.crop_operation_execution_warrant_v1(uuid,text,uuid) to service_role;

comment on function atlas.crop_cycle_requirement_snapshot_v1(uuid,date) is 'P9 crop Requirement Expression: transplant and harvest are independent source requirements. Harvestability is sufficient before buyer allocation; commercial target is a separate nonblocking truth gap.';