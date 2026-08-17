-- Reality Expression Pass 1.2 — Evidence / Adjudication Boundary.
-- Describes what evidence is still required to resolve a crop-to-space relation,
-- who may witness reality, who currently has authority to mutate represented
-- spatial/claim state, and which mutation paths are not neutral evidence intake.

create or replace function atlas.crop_cycle_relation_resolution_requirements_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_spatial jsonb;
  v_relation_state text;
  v_subject_extent_state text;
  v_claim_state text;
  v_active_cooccupant_count integer := 0;
  v_active_roles jsonb := '[]'::jsonb;
  v_requirements jsonb := '[]'::jsonb;
  v_resolution_paths jsonb := '[]'::jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_other record;
  v_other_cell_count integer;
  v_subject_entry_date date;
begin
  if p_crop_cycle_id is null then
    raise exception 'A crop cycle is required.' using errcode = '22023';
  end if;

  select * into v_cycle from atlas.crop_cycles where id = p_crop_cycle_id;
  if v_cycle.id is null then
    raise exception 'Crop cycle not found.' using errcode = 'P0002';
  end if;

  select * into v_object from atlas.growing_objects where id = v_cycle.object_id;
  if v_object.id is null then
    raise exception 'Growing object not found for crop cycle.' using errcode = 'P0002';
  end if;

  v_spatial := atlas.crop_cycle_spatial_truth_v1(v_cycle.id);
  v_relation_state := v_spatial #>> '{spaceRelationship,state}';
  v_subject_extent_state := v_spatial #>> '{subject,spatialExtent,state}';
  v_claim_state := v_spatial #>> '{claim,state}';
  v_active_cooccupant_count := coalesce((v_spatial #>> '{spaceRelationship,activeUnreleasedCooccupantCount}')::integer, 0);
  v_subject_entry_date := coalesce(v_cycle.planted_date, v_cycle.sown_date);

  select coalesce(jsonb_agg(role order by role), '[]'::jsonb)
  into v_active_roles
  from (
    select distinct membership.role
    from atlas.farm_memberships membership
    where membership.farm_id = v_cycle.farm_id and membership.active = true
  ) roles;

  if v_subject_extent_state <> 'explicit_cells' then
    v_requirements := v_requirements || jsonb_build_array(jsonb_build_object(
      'key','subject_spatial_extent','status','required',
      'blockingRelationResolution',(v_active_cooccupant_count > 0),'blockingClaimRepair',true,
      'question',format('Where within %s does %s physically occupy?',v_object.label,coalesce(v_cycle.variety || ' ','') || v_cycle.crop_label),
      'witness',jsonb_build_object('eligibility','active_farm_membership','currentActiveRoles',v_active_roles,'function','observe_physical_layout'),
      'adjudication',jsonb_build_object('jurisdiction','owner','existingMutationPath','atlas.record_crop_occupancy_note_v1(jsonb)','rule','Observation may supply evidence; represented occupancy geometry is not changed until the authorized spatial record is written.'),
      'sufficientEvidenceExamples',jsonb_build_array('explicit placement cells','direct field observation translated into explicit placement geometry'),
      'insufficientEvidenceExamples',jsonb_build_array('object membership alone','task completion alone','registry status alone')
    ));
  end if;

  for v_other in
    select other.* from atlas.crop_cycles other
    where other.object_id = v_cycle.object_id and other.id <> v_cycle.id
      and other.lifecycle_status = 'active' and other.cleared_date is null and other.turnover_date is null
    order by other.created_at, other.id
  loop
    select count(distinct cell.cell_key)::integer into v_other_cell_count
    from atlas.crop_placements placement
    join atlas.crop_placement_cells cell on cell.placement_id = placement.id
    where placement.crop_cycle_id = v_other.id and placement.object_id = v_cycle.object_id;

    v_requirements := v_requirements || jsonb_build_array(jsonb_build_object(
      'key','cooccupant_current_presence:' || v_other.id::text,'status','required',
      'blockingRelationResolution',true,'blockingClaimRepair',false,'subjectCropCycleId',v_other.id,
      'question',format('Are %s plants physically present in %s now?',coalesce(v_other.variety || ' ','') || v_other.crop_label,v_object.label),
      'witness',jsonb_build_object('eligibility','active_farm_membership','currentActiveRoles',v_active_roles,'function','observe_current_physical_presence'),
      'adjudication',jsonb_build_object('jurisdiction','owner','rule','A present/absent observation is evidence. It does not itself close, clear, supersede, or date the crop cycle.'),
      'resultBranches',jsonb_build_array(
        jsonb_build_object('observedResult','present','nextRequirement',case when v_other_cell_count > 0 and v_subject_extent_state = 'explicit_cells' then 'compare_explicit_geometry' else 'resolve_spatial_extent' end),
        jsonb_build_object('observedResult','absent','nextRequirement','establish_release_timing_or_leave_historical_timing_unknown'),
        jsonb_build_object('observedResult','uncertain','nextRequirement','remain_unresolved')
      )
    ));

    if v_other_cell_count = 0 then
      v_requirements := v_requirements || jsonb_build_array(jsonb_build_object(
        'key','cooccupant_spatial_extent:' || v_other.id::text,'status','conditional_if_present',
        'blockingRelationResolution',true,'blockingClaimRepair',false,'subjectCropCycleId',v_other.id,
        'question',format('If %s is still present, what part of %s does it physically occupy?',coalesce(v_other.variety || ' ','') || v_other.crop_label,v_object.label),
        'witness',jsonb_build_object('eligibility','active_farm_membership','currentActiveRoles',v_active_roles,'function','observe_physical_layout'),
        'adjudication',jsonb_build_object('jurisdiction','owner','existingMutationPath','atlas.record_crop_occupancy_note_v1(jsonb)'),
        'rule','Lawful sharing is only established by explicit disjoint geometry. Overlap does not automatically mean conflict or illegality; it remains a separate relation question.'
      ));
    end if;

    if v_subject_entry_date is not null then
      v_requirements := v_requirements || jsonb_build_array(jsonb_build_object(
        'key','cooccupant_release_timing:' || v_other.id::text,'status','conditional_if_absent',
        'blockingRelationResolution',false,'blockingHistoricalClassification',true,'subjectCropCycleId',v_other.id,
        'question',format('If %s is absent now, what evidence establishes whether it left %s before %s entered on %s?',coalesce(v_other.variety || ' ','') || v_other.crop_label,v_object.label,coalesce(v_cycle.variety || ' ','') || v_cycle.crop_label,v_subject_entry_date),
        'witness',jsonb_build_object('eligibility','direct_actor_or_contemporaneous_evidence','currentActiveRoles',v_active_roles,'function','supply_historical_release_evidence'),
        'adjudication',jsonb_build_object('jurisdiction','owner','rule','Present absence cannot be backdated into a historical clear date without evidence.'),
        'sufficientEvidenceExamples',jsonb_build_array('contemporaneous clear/turnover record','direct actor report with a supported date','dated field evidence establishing removal'),
        'insufficientEvidenceExamples',jsonb_build_array('crop is absent today','registry row was superseded','expected clear date passed')
      ));
    end if;
  end loop;

  if v_claim_state = 'missing' then
    v_requirements := v_requirements || jsonb_build_array(jsonb_build_object(
      'key','planting_claim_facts','status','required_before_claim_repair',
      'blockingRelationResolution',false,'blockingClaimRepair',true,
      'question',format('What quantity, unit, and coverage were actually planted for %s in %s?',coalesce(v_cycle.variety || ' ','') || v_cycle.crop_label,v_object.label),
      'witness',jsonb_build_object('eligibility','person_or_record_with_direct_planting_knowledge','function','supply_planting_facts'),
      'adjudication',jsonb_build_object('jurisdiction','owner_or_manager','existingMutationPath','atlas.record_planting_claim_v1(...)','rule','A planting claim may only be written from actual supported planting facts; unknown quantity or coverage is not invented to complete the registry.')
    ));
  end if;

  if v_relation_state = 'unresolved' then
    v_resolution_paths := jsonb_build_array(
      jsonb_build_object('key','prior_crop_released','when','cooccupant is absent and lawful release evidence is established','authorizedChange','owner records the supported clear/turnover truth','reclassification','recalculate spatial packet; sole active occupancy may become occupied','doesNotAuthorize','inventing a historical release date from present absence'),
      jsonb_build_object('key','lawful_disjoint_sharing','when','both crops are present and explicit geometry proves disjoint occupied space','authorizedChange','owner records evidence-backed placement geometry','reclassification','spatial packet may become shared','doesNotAuthorize','assuming sharing from same-object membership'),
      jsonb_build_object('key','overlapping_or_interplanted','when','both crops are present and evidence shows overlapping physical use','authorizedChange','none from this contract','reclassification','remain unresolved until an explicit overlap/interplant relation is represented','doesNotAuthorize','calling overlap conflict or lawful sharing without a represented relation'),
      jsonb_build_object('key','evidence_insufficient_or_conflicting','when','witnesses remain incomplete or disagree','authorizedChange','none','reclassification','remain unresolved','doesNotAuthorize','forced completeness')
    );
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key','neutral_relation_evidence_intake_missing','class','witness_channel_gap','severity','attention',
      'detail','Atlas currently has no authenticated neutral intake path for crop relation evidence. Direct inserts are not granted, and the existing member crop-observation command mutates crop lifecycle state.'
    ));
  end if;

  return jsonb_build_object(
    'contractVersion','crop_cycle_relation_resolution_requirements_v1','asOf',now(),
    'subject',jsonb_build_object('cropCycleId',v_cycle.id,'cropLabel',v_cycle.crop_label,'variety',v_cycle.variety,'objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,'entryDate',v_subject_entry_date,'relationState',v_relation_state,'claimState',v_claim_state),
    'jurisdiction',jsonb_build_object(
      'witness',jsonb_build_object('eligibility','active_farm_membership','currentActiveRoles',v_active_roles,'principle','Truth may enter from any lawful witness role; witnessing does not transfer mutation or adjudication authority.'),
      'spatialAdjudication',jsonb_build_object('currentRole','owner','basis','atlas.record_crop_occupancy_note_v1(jsonb) currently requires farm owner or service_role'),
      'plantingClaim',jsonb_build_object('currentRoles',jsonb_build_array('owner','manager'),'basis','atlas.record_planting_claim_v1(...) currently requires owner or manager membership')
    ),
    'intakeBoundary',jsonb_build_object(
      'neutralRelationEvidenceIntake',jsonb_build_object('state','missing','directAuthenticatedTableInsert',false),
      'existingMemberObservationPath',jsonb_build_object('function','atlas.record_crop_observation_for_member_v1(...)','state','available_but_mutating','warning','This command records an event and immediately updates crop_cycles state/projections. It must not be used as neutral evidence intake for an unresolved spatial relation.'),
      'existingSpatialMutationPath',jsonb_build_object('function','atlas.record_crop_occupancy_note_v1(jsonb)','state','owner_only_mutating','warning','Use only after evidence has been adjudicated; it writes/updates crop cycles, contents, placements, cells, observations, and occupancy evidence.'),
      'existingClaimMutationPath',jsonb_build_object('function','atlas.record_planting_claim_v1(...)','state','owner_manager_mutating','warning','Use only when required planting facts are actually known.')
    ),
    'requirements',v_requirements,'resolutionPaths',v_resolution_paths,'issues',v_issues
  );
end;
$function$;

revoke all on function atlas.crop_cycle_relation_resolution_requirements_v1(uuid) from public;
revoke execute on function atlas.crop_cycle_relation_resolution_requirements_v1(uuid) from anon;
revoke execute on function atlas.crop_cycle_relation_resolution_requirements_v1(uuid) from authenticated;
grant execute on function atlas.crop_cycle_relation_resolution_requirements_v1(uuid) to service_role;

comment on function atlas.crop_cycle_relation_resolution_requirements_v1(uuid) is
  'Read-only Reality Expression Pass 1.2 contract: identifies evidence needed to resolve crop spatial truth while separating witness jurisdiction from mutation/adjudication authority.';

create or replace function atlas.crop_cycle_reality_expression_v3(p_crop_cycle_id uuid)
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
  v_resolution := atlas.crop_cycle_relation_resolution_requirements_v1(p_crop_cycle_id);
  v_result := v_base || jsonb_build_object('contractVersion','crop_cycle_reality_expression_v3','baseContractVersion',v_base ->> 'contractVersion','resolutionBoundary',v_resolution - 'issues');
  v_result := jsonb_set(v_result,'{issues}',coalesce(v_base -> 'issues','[]'::jsonb) || coalesce(v_resolution -> 'issues','[]'::jsonb),true);
  return v_result;
end;
$function$;

revoke all on function atlas.crop_cycle_reality_expression_v3(uuid) from public;
revoke execute on function atlas.crop_cycle_reality_expression_v3(uuid) from anon;
revoke execute on function atlas.crop_cycle_reality_expression_v3(uuid) from authenticated;
grant execute on function atlas.crop_cycle_reality_expression_v3(uuid) to service_role;

comment on function atlas.crop_cycle_reality_expression_v3(uuid) is
  'Reality Expression v3: living-body + spatial truth + evidence/adjudication resolution boundary. Read-only and service-internal.';

-- Keep authenticated EXECUTE governance atomic with the function privilege changes.
-- The immediately following registry migration repeats this upsert as an ordered,
-- idempotent reconciliation pass; production final state is therefore unchanged.
insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, reviewed_at
)
values
(
  'atlas.crop_cycle_relation_resolution_requirements_v1(uuid)',
  'service_internal','verified','active',false,false,true,1,0,
  jsonb_build_object(
    'purpose','Describe the evidence and jurisdiction required to resolve one crop spatial relation without mutating reality.',
    'boundary','Reality Expression Pass 1.2 is read-only and service/internal. Witness capability is kept separate from spatial and claim mutation authority.',
    'truthLaw','Observation is evidence, not automatic adjudication. Present absence does not backdate release; same-object membership does not prove conflict or sharing.',
    'callerTruth','Composed by atlas.crop_cycle_reality_expression_v3(uuid).'
  ),
  now()
),
(
  'atlas.crop_cycle_reality_expression_v3(uuid)',
  'service_internal','verified','active',false,false,true,0,0,
  jsonb_build_object(
    'purpose','Compose living-body, spatial truth, and evidence/adjudication resolution boundary for one crop cycle.',
    'boundary','Service/internal read model only; no authenticated execution and no mutation authority.',
    'truthLaw','A reality packet may name missing evidence and lawful jurisdiction without forcing completeness or performing the adjudication itself.'
  ),
  now()
)
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    caller_count = excluded.caller_count,
    policy_reference_count = excluded.policy_reference_count,
    evidence = excluded.evidence,
    reviewed_at = excluded.reviewed_at;
