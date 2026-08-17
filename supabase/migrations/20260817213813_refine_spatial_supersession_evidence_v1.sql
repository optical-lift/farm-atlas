-- Reality Expression Pass 1.1 refinement.
--
-- A superseded registry row may represent a physically observed crop, a planning
-- record that never entered the bed, or a duplicate whose physical referent was
-- canonicalized elsewhere. Supersession alone proves none of those. Refine the
-- spatial packet so physical-entry evidence is evaluated independently.

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
  v_subject_entry_evidence_count integer := 0;
  v_subject_extent_state text := 'unknown';
  v_subject_physical_presence text := 'unknown';

  v_active_cooccupant_count integer := 0;
  v_active_cooccupants jsonb := '[]'::jsonb;
  v_all_active_cooccupants_disjoint boolean := false;

  v_superseded_history_count integer := 0;
  v_superseded_entry_without_release_count integer := 0;
  v_superseded_presence_unresolved_count integer := 0;
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

  select count(*)::integer
  into v_subject_entry_evidence_count
  from atlas.crop_occupancy_evidence evidence
  where evidence.crop_cycle_id = v_cycle.id
    and evidence.object_id = v_cycle.object_id
    and evidence.evidence_role in ('planting', 'observation', 'stage', 'quantity', 'placement');

  v_subject_extent_state := case
    when v_subject_cell_count > 0 then 'explicit_cells'
    when v_subject_placement_count > 0 then 'placement_without_cells'
    else 'unknown'
  end;

  v_subject_physical_presence := case
    when v_cycle.cleared_date is not null or v_cycle.turnover_date is not null then 'released'
    when (v_cycle.cycle_state = 'superseded' or v_cycle.lifecycle_status = 'archived')
      and (
        v_subject_entry_evidence_count > 0
        or v_cycle.sown_date is not null
        or v_cycle.planted_date is not null
        or v_cycle.germination_checked_date is not null
        or v_cycle.harvest_started_date is not null
        or v_cycle.last_harvest_date is not null
      ) then 'entry_evidenced_exit_unproven'
    when v_cycle.cycle_state = 'superseded' or v_cycle.lifecycle_status = 'archived' then 'physical_presence_unresolved'
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
    select
      other.*,
      (select count(*)::integer
       from atlas.crop_occupancy_evidence e
       where e.crop_cycle_id = other.id
         and e.object_id = v_cycle.object_id
         and e.evidence_role in ('planting', 'observation', 'stage', 'quantity', 'placement')) as entry_evidence_count
    from atlas.crop_cycles other
    where other.object_id = v_cycle.object_id
      and other.id <> v_cycle.id
      and (other.cycle_state = 'superseded' or other.lifecycle_status = 'archived')
  ), classified as (
    select superseded.*,
      (
        superseded.entry_evidence_count > 0
        or superseded.sown_date is not null
        or superseded.planted_date is not null
        or superseded.germination_checked_date is not null
        or superseded.harvest_started_date is not null
        or superseded.last_harvest_date is not null
      ) as has_entry_evidence
    from superseded
  )
  select
    count(*)::integer,
    count(*) filter (
      where classified.cleared_date is null
        and classified.turnover_date is null
        and classified.has_entry_evidence
    )::integer,
    count(*) filter (
      where classified.cleared_date is null
        and classified.turnover_date is null
        and not classified.has_entry_evidence
    )::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'cropCycleId', classified.id,
      'cropCycleKey', classified.crop_cycle_key,
      'cropLabel', classified.crop_label,
      'variety', classified.variety,
      'registry', jsonb_build_object(
        'cycleState', classified.cycle_state,
        'lifecycleStatus', classified.lifecycle_status
      ),
      'entryEvidence', jsonb_build_object(
        'occupancyEvidenceCount', classified.entry_evidence_count,
        'lifecycleEntryEvidence', (
          classified.sown_date is not null
          or classified.planted_date is not null
          or classified.germination_checked_date is not null
          or classified.harvest_started_date is not null
          or classified.last_harvest_date is not null
        ),
        'present', classified.has_entry_evidence
      ),
      'physicalPresence', jsonb_build_object(
        'state', case
          when classified.cleared_date is not null or classified.turnover_date is not null then 'released'
          when classified.has_entry_evidence then 'entry_evidenced_exit_unproven'
          else 'physical_presence_unresolved'
        end,
        'clearedDate', classified.cleared_date,
        'turnoverDate', classified.turnover_date
      )
    ) order by classified.created_at, classified.id), '[]'::jsonb)
  into
    v_superseded_history_count,
    v_superseded_entry_without_release_count,
    v_superseded_presence_unresolved_count,
    v_superseded_history
  from classified;

  v_space_relationship_state := case
    when v_subject_physical_presence = 'released' then 'released'
    when v_subject_physical_presence in ('entry_evidenced_exit_unproven', 'physical_presence_unresolved') then 'unresolved'
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

  if v_superseded_history_count > 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'supersession_not_release',
      'class', 'noncollapse_guard',
      'severity', 'information',
      'detail', format(
        'Registry supersession is not physical-release evidence. %s superseded/archived record(s) have physical-entry evidence but no clear/turnover evidence; %s have insufficient evidence to establish physical presence from the superseded row itself.',
        v_superseded_entry_without_release_count,
        v_superseded_presence_unresolved_count
      )
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
      'entryEvidenceCount', v_subject_entry_evidence_count,
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
      'entryEvidencedWithoutReleaseCount', v_superseded_entry_without_release_count,
      'physicalPresenceUnresolvedCount', v_superseded_presence_unresolved_count,
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
  'Read-only spatial/claim truth for one crop cycle. Separates registry status, physical entry/exit evidence, represented claims, and explicit co-occupancy evidence; registry supersession never implies physical release or prior physical presence.';