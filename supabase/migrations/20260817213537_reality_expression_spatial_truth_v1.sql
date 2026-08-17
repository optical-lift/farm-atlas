-- Reality Expression Pass 1.1 — Relation and Claim Truth.
--
-- Separates registry disposition, physical-presence evidence, represented spatial
-- claims, and co-occupancy evidence. Registry supersession is never treated as
-- evidence that a crop physically left a growing object. Lawful sharing is only
-- reported when explicit placement cells prove disjoint occupied space.

create or replace function atlas.crop_cycle_spatial_truth_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_claim atlas.planting_claims%rowtype;

  v_claim_state text := 'missing';
  v_claim_object_count integer := 0;
  v_claim_objects jsonb := '[]'::jsonb;

  v_subject_placement_count integer := 0;
  v_subject_cell_count integer := 0;
  v_subject_extent_state text := 'unknown';
  v_subject_physical_presence text := 'unknown';

  v_active_cooccupant_count integer := 0;
  v_active_cooccupants jsonb := '[]'::jsonb;
  v_all_active_cooccupants_disjoint boolean := false;

  v_superseded_history_count integer := 0;
  v_superseded_without_release_count integer := 0;
  v_superseded_history jsonb := '[]'::jsonb;

  v_space_relationship_state text := 'unresolved';
  v_issues jsonb := '[]'::jsonb;
begin
  if p_crop_cycle_id is null then
    raise exception 'A crop cycle is required.' using errcode = '22023';
  end if;

  select * into v_cycle
  from atlas.crop_cycles
  where id = p_crop_cycle_id;

  if v_cycle.id is null then
    raise exception 'Crop cycle not found.' using errcode = 'P0002';
  end if;

  if v_cycle.planting_claim_id is not null then
    select * into v_claim
    from atlas.planting_claims
    where id = v_cycle.planting_claim_id;

    select count(*)::integer,
      coalesce(jsonb_agg(jsonb_build_object(
        'plantingClaimObjectId', claim_object.id,
        'objectId', claim_object.object_id,
        'coverageKind', claim_object.coverage_kind,
        'coverageAmount', claim_object.coverage_amount,
        'coverageUnit', claim_object.coverage_unit
      ) order by claim_object.created_at, claim_object.id), '[]'::jsonb)
    into v_claim_object_count, v_claim_objects
    from atlas.planting_claim_objects claim_object
    where claim_object.planting_claim_id = v_cycle.planting_claim_id
      and claim_object.object_id = v_cycle.object_id;

    v_claim_state := case
      when v_claim.id is null then 'claim_record_missing'
      when v_claim_object_count = 0 then 'claim_object_missing'
      else 'represented'
    end;
  end if;

  select count(*)::integer
  into v_subject_placement_count
  from atlas.crop_placements placement
  where placement.crop_cycle_id = v_cycle.id
    and placement.object_id = v_cycle.object_id;

  select count(distinct cell.cell_key)::integer
  into v_subject_cell_count
  from atlas.crop_placements placement
  join atlas.crop_placement_cells cell on cell.placement_id = placement.id
  where placement.crop_cycle_id = v_cycle.id
    and placement.object_id = v_cycle.object_id;

  v_subject_extent_state := case
    when v_subject_cell_count > 0 then 'explicit_cells'
    when v_subject_placement_count > 0 then 'placement_without_cells'
    else 'unknown'
  end;

  v_subject_physical_presence := case
    when v_cycle.cleared_date is not null or v_cycle.turnover_date is not null then 'released'
    when v_cycle.cycle_state = 'superseded' or v_cycle.lifecycle_status = 'archived' then 'unknown_after_registry_supersession'
    when v_cycle.lifecycle_status = 'active' then 'present_on_record'
    else 'unknown'
  end;

  with subject_cells as (
    select distinct cell.cell_key
    from atlas.crop_placements placement
    join atlas.crop_placement_cells cell on cell.placement_id = placement.id
    where placement.crop_cycle_id = v_cycle.id
      and placement.object_id = v_cycle.object_id
  ), current_others as (
    select other.*
    from atlas.crop_cycles other
    where other.object_id = v_cycle.object_id
      and other.id <> v_cycle.id
      and other.lifecycle_status = 'active'
      and other.cleared_date is null
      and other.turnover_date is null
  ), evidence as (
    select
      other.id,
      other.crop_cycle_key,
      other.crop_label,
      other.variety,
      other.cycle_state,
      other.lifecycle_status,
      other.sown_date,
      other.planted_date,
      other.harvest_started_date,
      other.last_harvest_date,
      other.cleared_date,
      other.turnover_date,
      other.expected_clear_date,
      other.planting_claim_id,
      other.created_at,
      (select count(*)::integer from atlas.crop_placements p where p.crop_cycle_id = other.id and p.object_id = v_cycle.object_id) as placement_count,
      (select count(distinct c.cell_key)::integer
       from atlas.crop_placements p
       join atlas.crop_placement_cells c on c.placement_id = p.id
       where p.crop_cycle_id = other.id and p.object_id = v_cycle.object_id) as cell_count,
      (select count(distinct c.cell_key)::integer
       from atlas.crop_placements p
       join atlas.crop_placement_cells c on c.placement_id = p.id
       join subject_cells sc on sc.cell_key = c.cell_key
       where p.crop_cycle_id = other.id and p.object_id = v_cycle.object_id) as overlap_cell_count
    from current_others other
  )
  select
    count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'cropCycleId', evidence.id,
      'cropCycleKey', evidence.crop_cycle_key,
      'cropLabel', evidence.crop_label,
      'variety', evidence.variety,
      'registry', jsonb_build_object(
        'cycleState', evidence.cycle_state,
        'lifecycleStatus', evidence.lifecycle_status
      ),
      'physicalPresence', jsonb_build_object(
        'state', 'not_released_on_record',
        'sownDate', evidence.sown_date,
        'plantedDate', evidence.planted_date,
        'harvestStartedDate', evidence.harvest_started_date,
        'lastHarvestDate', evidence.last_harvest_date,
        'expectedClearDate', evidence.expected_clear_date,
        'clearedDate', evidence.cleared_date,
        'turnoverDate', evidence.turnover_date
      ),
      'claim', jsonb_build_object(
        'plantingClaimId', evidence.planting_claim_id,
        'state', case when evidence.planting_claim_id is null then 'missing' else 'present_unadjudicated' end
      ),
      'spatialEvidence', jsonb_build_object(
        'placementCount', evidence.placement_count,
        'cellCount', evidence.cell_count,
        'overlapCellCount', evidence.overlap_cell_count,
        'disjointCellProof', (v_subject_cell_count > 0 and evidence.cell_count > 0 and evidence.overlap_cell_count = 0)
      )
    ) order by evidence.created_at, evidence.id), '[]'::jsonb),
    coalesce(bool_and(v_subject_cell_count > 0 and evidence.cell_count > 0 and evidence.overlap_cell_count = 0), false)
  into v_active_cooccupant_count, v_active_cooccupants, v_all_active_cooccupants_disjoint
  from evidence;

  with superseded as (
    select other.*
    from atlas.crop_cycles other
    where other.object_id = v_cycle.object_id
      and other.id <> v_cycle.id
      and (other.cycle_state = 'superseded' or other.lifecycle_status = 'archived')
  )
  select
    count(*)::integer,
    count(*) filter (where superseded.cleared_date is null and superseded.turnover_date is null)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'cropCycleId', superseded.id,
      'cropCycleKey', superseded.crop_cycle_key,
      'cropLabel', superseded.crop_label,
      'variety', superseded.variety,
      'registry', jsonb_build_object(
        'cycleState', superseded.cycle_state,
        'lifecycleStatus', superseded.lifecycle_status
      ),
      'physicalPresence', jsonb_build_object(
        'state', case
          when superseded.cleared_date is not null or superseded.turnover_date is not null then 'released'
          else 'unknown_after_registry_supersession'
        end,
        'clearedDate', superseded.cleared_date,
        'turnoverDate', superseded.turnover_date
      )
    ) order by superseded.created_at, superseded.id), '[]'::jsonb)
  into v_superseded_history_count, v_superseded_without_release_count, v_superseded_history
  from superseded;

  v_space_relationship_state := case
    when v_subject_physical_presence = 'released' then 'released'
    when v_subject_physical_presence = 'unknown_after_registry_supersession' then 'unresolved'
    when v_active_cooccupant_count = 0 then 'occupied'
    when v_all_active_cooccupants_disjoint then 'shared'
    else 'unresolved'
  end;

  if v_subject_extent_state <> 'explicit_cells' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'spatial_extent_unknown',
      'class', 'spatial_evidence_gap',
      'severity', 'attention',
      'detail', 'The crop cycle has no explicit placement-cell geometry on its growing object. Coarse object membership is preserved, but sub-object extent is not inferred.'
    ));
  end if;

  if v_active_cooccupant_count > 0 and not v_all_active_cooccupants_disjoint then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'relation_evidence_required',
      'class', 'relation_gap',
      'severity', 'attention',
      'detail', 'Another active, unreleased crop cycle is recorded on the same growing object, and explicit disjoint placement-cell evidence is absent. The relationship remains unresolved rather than being called conflict or lawful sharing.'
    ));
  end if;

  if v_superseded_without_release_count > 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'supersession_not_release',
      'class', 'noncollapse_guard',
      'severity', 'information',
      'detail', 'One or more same-object crop records are registry-superseded or archived without physical clear/turnover evidence. Registry disposition is preserved separately from physical departure.'
    ));
  end if;

  if v_claim_state = 'claim_object_missing' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'claim_object_missing',
      'class', 'claim_gap',
      'severity', 'attention',
      'detail', 'The crop cycle references a planting claim, but that claim does not currently represent this growing object.'
    ));
  elsif v_claim_state = 'claim_record_missing' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'claim_record_missing',
      'class', 'claim_gap',
      'severity', 'high',
      'detail', 'The crop cycle references a planting_claim_id whose claim record is missing.'
    ));
  end if;

  return jsonb_build_object(
    'contractVersion', 'crop_cycle_spatial_truth_v1',
    'asOf', now(),
    'subject', jsonb_build_object(
      'cropCycleId', v_cycle.id,
      'objectId', v_cycle.object_id,
      'registry', jsonb_build_object(
        'cycleState', v_cycle.cycle_state,
        'lifecycleStatus', v_cycle.lifecycle_status
      ),
      'physicalPresence', jsonb_build_object(
        'state', v_subject_physical_presence,
        'clearedDate', v_cycle.cleared_date,
        'turnoverDate', v_cycle.turnover_date
      ),
      'spatialExtent', jsonb_build_object(
        'state', v_subject_extent_state,
        'placementCount', v_subject_placement_count,
        'cellCount', v_subject_cell_count
      )
    ),
    'claim', jsonb_build_object(
      'state', v_claim_state,
      'plantingClaimId', v_cycle.planting_claim_id,
      'claimStatus', v_claim.status,
      'claimConfidence', v_claim.confidence,
      'objectLinkCount', v_claim_object_count,
      'objectLinks', v_claim_objects
    ),
    'spaceRelationship', jsonb_build_object(
      'state', v_space_relationship_state,
      'activeUnreleasedCooccupantCount', v_active_cooccupant_count,
      'explicitDisjointCellProofForAll', v_all_active_cooccupants_disjoint,
      'cooccupants', v_active_cooccupants
    ),
    'registryHistory', jsonb_build_object(
      'supersededOrArchivedCount', v_superseded_history_count,
      'withoutPhysicalReleaseEvidenceCount', v_superseded_without_release_count,
      'records', v_superseded_history
    ),
    'issues', v_issues
  );
end;
$function$;

revoke all on function atlas.crop_cycle_spatial_truth_v1(uuid) from public;
revoke execute on function atlas.crop_cycle_spatial_truth_v1(uuid) from anon;
revoke execute on function atlas.crop_cycle_spatial_truth_v1(uuid) from authenticated;
grant execute on function atlas.crop_cycle_spatial_truth_v1(uuid) to service_role;

comment on function atlas.crop_cycle_spatial_truth_v1(uuid) is
  'Read-only spatial/claim truth for one crop cycle. Separates registry status, physical presence, represented claims, and explicit co-occupancy evidence; registry supersession never implies physical release.';

create or replace function atlas.crop_cycle_reality_expression_v2(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_base jsonb;
  v_spatial jsonb;
  v_result jsonb;
begin
  v_base := atlas.crop_cycle_reality_expression_v1(p_crop_cycle_id);
  v_spatial := atlas.crop_cycle_spatial_truth_v1(p_crop_cycle_id);

  v_result := v_base || jsonb_build_object(
    'contractVersion', 'crop_cycle_reality_expression_v2',
    'baseContractVersion', v_base ->> 'contractVersion',
    'spatialTruth', v_spatial - 'issues'
  );

  v_result := jsonb_set(
    v_result,
    '{issues}',
    coalesce(v_base -> 'issues', '[]'::jsonb) || coalesce(v_spatial -> 'issues', '[]'::jsonb),
    true
  );

  return v_result;
end;
$function$;

revoke all on function atlas.crop_cycle_reality_expression_v2(uuid) from public;
revoke execute on function atlas.crop_cycle_reality_expression_v2(uuid) from anon;
revoke execute on function atlas.crop_cycle_reality_expression_v2(uuid) from authenticated;
grant execute on function atlas.crop_cycle_reality_expression_v2(uuid) to service_role;

comment on function atlas.crop_cycle_reality_expression_v2(uuid) is
  'Reality Expression v2: v1 living-body packet plus explicit relation/claim truth. Read-only and service-internal.';