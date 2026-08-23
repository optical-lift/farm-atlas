create or replace function atlas.crop_cycle_requirement_snapshot_pre_future_truth_v1(p_crop_cycle_id uuid, p_as_of_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
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

revoke all on function atlas.crop_cycle_requirement_snapshot_pre_future_truth_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.crop_cycle_requirement_snapshot_pre_future_truth_v1(uuid,date) to service_role;