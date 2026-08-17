-- Reality Expression Pass 1 — One Living Body.
--
-- This is a read-only, service-internal projection over existing Atlas truth.
-- It does not repair data, release work, choose between conflicting witnesses,
-- or widen authenticated access. The first live specimens are the ProCut Orange
-- crop cycles in Field Rows 13 and 14.

create or replace function atlas.crop_cycle_reality_expression_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_zone atlas.zones%rowtype;
  v_source_task atlas.tasks%rowtype;
  v_source_membership atlas.farm_memberships%rowtype;
  v_claim atlas.planting_claims%rowtype;

  v_task_germ_start date;
  v_task_germ_end date;
  v_task_harvest_start date;
  v_task_harvest_end date;
  v_task_clear_date date;
  v_germination_witness_status text := 'unknown';
  v_harvest_witness_status text := 'unknown';

  v_source_outcomes jsonb := '[]'::jsonb;
  v_source_outcome_count integer := 0;
  v_linked_tasks jsonb := '[]'::jsonb;
  v_linked_task_count integer := 0;
  v_cooccupants jsonb := '[]'::jsonb;
  v_cooccupant_count integer := 0;
  v_lot_provenance jsonb := '[]'::jsonb;
  v_lot_count integer := 0;

  v_rhythm_state_id uuid;
  v_rhythm_state text;
  v_rhythm_warning_at timestamptz;
  v_rhythm_due_at timestamptz;
  v_rhythm_failure_at timestamptz;
  v_rhythm_current_task_id uuid;
  v_rhythm_current_occurrence_id uuid;
  v_rhythm_rule_id uuid;
  v_rhythm_rule_key text;
  v_rhythm_rule_version integer;
  v_rhythm_rule_label text;
  v_rhythm_binding_id uuid;
  v_rhythm_binding_key text;
  v_operation_fitness text := 'unresolved';
  v_continuity_state text := 'unresolved';

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

  select * into v_object
  from atlas.growing_objects
  where id = v_cycle.object_id;

  if v_object.zone_id is not null then
    select * into v_zone
    from atlas.zones
    where id = v_object.zone_id;
  end if;

  if v_cycle.source_task_id is not null then
    select * into v_source_task
    from atlas.tasks
    where id = v_cycle.source_task_id;
  end if;

  if v_source_task.assigned_membership_id is not null then
    select * into v_source_membership
    from atlas.farm_memberships
    where id = v_source_task.assigned_membership_id;
  end if;

  if v_cycle.planting_claim_id is not null then
    select * into v_claim
    from atlas.planting_claims
    where id = v_cycle.planting_claim_id;
  end if;

  if coalesce(v_source_task.metadata ->> 'projected_germination_start', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_task_germ_start := (v_source_task.metadata ->> 'projected_germination_start')::date;
  end if;
  if coalesce(v_source_task.metadata ->> 'projected_germination_end', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_task_germ_end := (v_source_task.metadata ->> 'projected_germination_end')::date;
  end if;
  if coalesce(v_source_task.metadata ->> 'projected_harvest_start', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_task_harvest_start := (v_source_task.metadata ->> 'projected_harvest_start')::date;
  end if;
  if coalesce(v_source_task.metadata ->> 'projected_harvest_end', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_task_harvest_end := (v_source_task.metadata ->> 'projected_harvest_end')::date;
  end if;
  if coalesce(v_source_task.metadata ->> 'projected_clear_bed_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_task_clear_date := (v_source_task.metadata ->> 'projected_clear_bed_date')::date;
  end if;

  v_germination_witness_status := case
    when v_task_germ_start is not null
      and v_task_germ_end is not null
      and v_cycle.expected_germination_start is not null
      and v_cycle.expected_germination_end is not null
      and v_task_germ_start = v_cycle.expected_germination_start
      and v_task_germ_end = v_cycle.expected_germination_end
      then 'aligned_witnesses'
    when v_task_germ_start is not null
      and v_task_germ_end is not null
      and v_cycle.expected_germination_start is not null
      and v_cycle.expected_germination_end is not null
      then 'conflicting_witnesses'
    when v_task_germ_start is not null
      or v_task_germ_end is not null
      or v_cycle.expected_germination_start is not null
      or v_cycle.expected_germination_end is not null
      then 'single_or_partial_witness'
    else 'unknown'
  end;

  v_harvest_witness_status := case
    when v_task_harvest_start is not null
      and v_task_harvest_end is not null
      and v_cycle.expected_harvest_watch_start is not null
      and v_cycle.expected_harvest_watch_end is not null
      and v_task_harvest_start = v_cycle.expected_harvest_watch_start
      and v_task_harvest_end = v_cycle.expected_harvest_watch_end
      then 'aligned_witnesses'
    when v_task_harvest_start is not null
      and v_task_harvest_end is not null
      and v_cycle.expected_harvest_watch_start is not null
      and v_cycle.expected_harvest_watch_end is not null
      then 'conflicting_witnesses'
    when v_task_harvest_start is not null
      or v_task_harvest_end is not null
      or v_cycle.expected_harvest_watch_start is not null
      or v_cycle.expected_harvest_watch_end is not null
      then 'single_or_partial_witness'
    else 'unknown'
  end;

  if v_source_task.id is not null then
    select count(*)::integer,
      coalesce(jsonb_agg(jsonb_build_object(
        'eventId', event.id,
        'outcome', event.outcome,
        'note', event.note,
        'createdAt', event.created_at,
        'metadata', coalesce(event.metadata, '{}'::jsonb)
      ) order by event.created_at, event.id), '[]'::jsonb)
    into v_source_outcome_count, v_source_outcomes
    from atlas.task_outcome_events event
    where event.task_id = v_source_task.id;
  end if;

  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'taskId', task.id,
      'title', task.title,
      'taskType', task.task_type,
      'actionKey', task.action_key,
      'status', task.status,
      'dueDate', task.due_date,
      'relationRole', relation.role,
      'relationConfidence', relation.confidence,
      'relationSource', relation.source
    ) order by task.created_at, task.id), '[]'::jsonb)
  into v_linked_task_count, v_linked_tasks
  from atlas.task_crop_cycles relation
  join atlas.tasks task on task.id = relation.task_id
  where relation.crop_cycle_id = v_cycle.id
    and task.id is distinct from v_cycle.source_task_id
    and task.status <> 'archived';

  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'cropCycleId', other.id,
      'cropLabel', other.crop_label,
      'variety', other.variety,
      'cycleState', other.cycle_state,
      'lifecycleStatus', other.lifecycle_status,
      'sownDate', other.sown_date,
      'plantedDate', other.planted_date,
      'clearedDate', other.cleared_date,
      'turnoverDate', other.turnover_date,
      'plantingClaimId', other.planting_claim_id
    ) order by other.created_at, other.id), '[]'::jsonb)
  into v_cooccupant_count, v_cooccupants
  from atlas.crop_cycles other
  where other.object_id = v_cycle.object_id
    and other.id <> v_cycle.id
    and other.lifecycle_status = 'active';

  if v_source_task.id is not null then
    select count(*)::integer,
      coalesce(jsonb_agg(jsonb_build_object(
        'productionLotId', lot.id,
        'lotKey', lot.stable_key,
        'lotLabel', lot.lot_label,
        'currentStage', lot.current_stage,
        'lifecycleStatus', lot.lifecycle_status,
        'linkRole', link.link_role,
        'linkSource', link.source
      ) order by lot.created_at, lot.id), '[]'::jsonb)
    into v_lot_count, v_lot_provenance
    from atlas.production_lot_tasks link
    join atlas.production_lots lot on lot.id = link.production_lot_id
    where link.task_id = v_source_task.id;
  end if;

  select
    state.id,
    state.state,
    state.warning_at,
    state.due_at,
    state.failure_at,
    state.current_task_id,
    state.current_occurrence_id,
    rule.id,
    rule.rule_key,
    rule.version,
    rule.label,
    binding.id,
    binding.binding_key
  into
    v_rhythm_state_id,
    v_rhythm_state,
    v_rhythm_warning_at,
    v_rhythm_due_at,
    v_rhythm_failure_at,
    v_rhythm_current_task_id,
    v_rhythm_current_occurrence_id,
    v_rhythm_rule_id,
    v_rhythm_rule_key,
    v_rhythm_rule_version,
    v_rhythm_rule_label,
    v_rhythm_binding_id,
    v_rhythm_binding_key
  from atlas.rhythm_state state
  join atlas.rhythm_bindings binding on binding.id = state.rhythm_binding_id
  join atlas.rhythm_rules rule on rule.id = state.rhythm_rule_id
  where state.subject_kind = 'crop_cycle'
    and state.subject_id = v_cycle.id
    and state.rhythm_key = 'germination_watch'
  order by binding.active desc, (rule.status = 'active') desc, state.updated_at desc, state.id
  limit 1;

  if v_rhythm_state_id is not null then
    v_operation_fitness := case
      when v_rhythm_warning_at is not null and now() < v_rhythm_warning_at then 'not_yet'
      when v_rhythm_due_at is not null and now() < v_rhythm_due_at then 'available'
      when v_rhythm_failure_at is not null and now() < v_rhythm_failure_at then 'required'
      when v_rhythm_failure_at is not null and now() >= v_rhythm_failure_at then 'failure_boundary_crossed'
      else 'state_known_timing_unresolved'
    end;

    v_continuity_state := case
      when v_rhythm_current_task_id is not null then 'released_operation_present'
      else 'future_gate_present'
    end;
  elsif v_linked_task_count > 0 then
    v_continuity_state := 'linked_operation_present';
  else
    v_continuity_state := 'unresolved';
  end if;

  if v_germination_witness_status = 'conflicting_witnesses' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'conflicting_germination_witnesses',
      'class', 'epistemic_conflict',
      'severity', 'attention',
      'detail', 'The historical sow-task projection and the canonical crop-cycle expectation describe different germination windows. Both are preserved; the active rhythm state is reported separately as the current operation-timing contract.'
    ));
  end if;

  if v_cycle.planting_claim_id is null then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'missing_planting_claim',
      'class', 'claim_gap',
      'severity', 'attention',
      'detail', 'The living crop cycle has no planting_claim_id, so its spatial claim is not represented through the planting-claim contract.'
    ));
  end if;

  if v_cooccupant_count > 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'active_shared_destination_requires_relation_evidence',
      'class', 'relation_gap',
      'severity', 'attention',
      'detail', 'Another active crop cycle is recorded on the same growing object. This packet does not infer conflict or lawful co-occupancy; the relationship remains unresolved until evidence establishes it.'
    ));
  end if;

  if v_lot_count = 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'no_production_lot_provenance',
      'class', 'provenance_gap',
      'severity', 'information',
      'detail', 'No Production Lot is linked through the crop cycle source task. The current crop remains valid crop-cycle truth; this is an architecture/provenance gap, not a claim that the crop does not exist.'
    ));
  end if;

  if v_continuity_state = 'unresolved' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key', 'living_subject_without_known_continuation',
      'class', 'continuity_gap',
      'severity', 'high',
      'detail', 'The active crop has no linked continuation and no germination-watch state in this packet.'
    ));
  end if;

  return jsonb_build_object(
    'contractVersion', 'crop_cycle_reality_expression_v1',
    'asOf', now(),
    'subject', jsonb_build_object(
      'domain', 'production',
      'kind', 'crop_cycle',
      'id', v_cycle.id,
      'cropCycleKey', v_cycle.crop_cycle_key,
      'cropLabel', v_cycle.crop_label,
      'variety', v_cycle.variety,
      'cycleState', v_cycle.cycle_state,
      'lifecycleStatus', v_cycle.lifecycle_status
    ),
    'source', jsonb_build_object(
      'sourceTaskId', v_source_task.id,
      'sourceEventId', v_cycle.source_event_id,
      'task', case when v_source_task.id is null then null else jsonb_build_object(
        'title', v_source_task.title,
        'status', v_source_task.status,
        'dueDate', v_source_task.due_date,
        'completedAt', v_source_task.completed_at,
        'actionKey', v_source_task.action_key,
        'operationClass', v_source_task.operation_class,
        'commitmentKind', v_source_task.commitment_kind,
        'assignedMembershipId', v_source_task.assigned_membership_id,
        'assignedWorkerKey', v_source_membership.worker_key,
        'resultEvidenceRequired', coalesce(v_source_task.metadata -> 'worker_result_lines', '[]'::jsonb),
        'outcomeEventCount', v_source_outcome_count,
        'outcomes', v_source_outcomes
      ) end
    ),
    'witnesses', jsonb_build_object(
      'currentState', jsonb_build_object(
        'recordedState', v_cycle.cycle_state,
        'lifecycleStatus', v_cycle.lifecycle_status,
        'sownDate', v_cycle.sown_date,
        'plantedDate', v_cycle.planted_date,
        'germinationCheckedDate', v_cycle.germination_checked_date,
        'epistemicStatus', 'canonical_lifecycle_record',
        'quantity', case
          when v_cycle.coverage_amount is not null then jsonb_build_object(
            'value', v_cycle.coverage_amount,
            'unit', v_cycle.coverage_unit,
            'kind', v_cycle.coverage_kind,
            'status', 'recorded_coverage'
          )
          else jsonb_build_object('value', null, 'unit', null, 'kind', null, 'status', 'unknown')
        end
      ),
      'germinationTiming', jsonb_build_object(
        'status', v_germination_witness_status,
        'historicalTaskProjection', jsonb_build_object('start', v_task_germ_start, 'end', v_task_germ_end),
        'canonicalCycleExpectation', jsonb_build_object('start', v_cycle.expected_germination_start, 'end', v_cycle.expected_germination_end),
        'operativeContractSource', case when v_rhythm_state_id is not null then 'active_germination_rhythm' else 'none_identified' end
      ),
      'harvestTiming', jsonb_build_object(
        'status', v_harvest_witness_status,
        'historicalTaskProjection', jsonb_build_object('start', v_task_harvest_start, 'end', v_task_harvest_end),
        'canonicalCycleExpectation', jsonb_build_object('start', v_cycle.expected_harvest_watch_start, 'end', v_cycle.expected_harvest_watch_end),
        'historicalTaskClearProjection', v_task_clear_date,
        'canonicalExpectedClearDate', v_cycle.expected_clear_date
      )
    ),
    'flowBuffer', jsonb_build_object(
      'location', case when v_object.id is null then null else jsonb_build_object(
        'objectId', v_object.id,
        'objectKey', v_object.stable_key,
        'objectLabel', v_object.label,
        'objectType', v_object.object_type,
        'zoneId', v_zone.id,
        'zoneKey', v_zone.stable_key,
        'zoneLabel', v_zone.label,
        'lengthFt', v_object.length_ft,
        'widthFt', v_object.width_ft,
        'areaSqft', v_object.area_sqft
      ) end,
      'plantingClaim', case when v_claim.id is null then jsonb_build_object(
        'status', 'missing',
        'claimId', null
      ) else jsonb_build_object(
        'status', v_claim.status,
        'claimId', v_claim.id,
        'confidence', v_claim.confidence,
        'amount', v_claim.amount,
        'unit', v_claim.unit,
        'plantingMethod', v_claim.planting_method,
        'plantedDate', v_claim.planted_date
      ) end,
      'activeCoOccupantCount', v_cooccupant_count,
      'activeCoOccupants', v_cooccupants,
      'sharedDestinationRelationStatus', case when v_cooccupant_count > 0 then 'relation_evidence_required' else 'no_other_active_cycle_recorded' end
    ),
    'claims', jsonb_build_object(
      'productionLotLinkCount', v_lot_count,
      'productionLotProvenance', v_lot_provenance,
      'availabilityStatus', case
        when v_cycle.planting_claim_id is null then 'physical_subject_recorded_without_planting_claim'
        else 'planting_claim_present'
      end
    ),
    'fittingOperation', case when v_rhythm_state_id is null then jsonb_build_object(
      'operationClass', null,
      'state', 'unresolved',
      'source', null
    ) else jsonb_build_object(
      'operationClass', 'observe_germination',
      'state', v_operation_fitness,
      'source', 'germination_watch_rhythm',
      'rhythmStateId', v_rhythm_state_id,
      'rhythmState', v_rhythm_state,
      'warningAt', v_rhythm_warning_at,
      'dueAt', v_rhythm_due_at,
      'failureAt', v_rhythm_failure_at,
      'currentTaskId', v_rhythm_current_task_id,
      'currentOccurrenceId', v_rhythm_current_occurrence_id,
      'rule', jsonb_build_object(
        'id', v_rhythm_rule_id,
        'key', v_rhythm_rule_key,
        'version', v_rhythm_rule_version,
        'label', v_rhythm_rule_label
      ),
      'binding', jsonb_build_object(
        'id', v_rhythm_binding_id,
        'key', v_rhythm_binding_key
      )
    ) end,
    'jurisdiction', jsonb_build_object(
      'domain', 'farm_execution',
      'nextExecutionCarrier', case when v_rhythm_current_task_id is null then null else (
        select task.assigned_membership_id from atlas.tasks task where task.id = v_rhythm_current_task_id
      ) end,
      'carrierStatus', case when v_rhythm_current_task_id is null then 'not_assigned_until_release' else 'assigned_on_released_task' end,
      'decisionAuthority', 'not_evaluated_in_v1'
    ),
    'continuity', jsonb_build_object(
      'state', v_continuity_state,
      'linkedDownstreamTaskCount', v_linked_task_count,
      'linkedDownstreamTasks', v_linked_tasks,
      'silentNothing', (v_continuity_state = 'unresolved'),
      'nextKnownBoundary', case when v_rhythm_state_id is null then null else jsonb_build_object(
        'kind', 'germination_watch',
        'warningAt', v_rhythm_warning_at,
        'dueAt', v_rhythm_due_at,
        'failureAt', v_rhythm_failure_at
      ) end
    ),
    'issues', v_issues
  );
end;
$function$;

comment on function atlas.crop_cycle_reality_expression_v1(uuid) is
  'Reality Expression Pass 1 read model for one crop cycle. Preserves source, witness, state, location/buffer, claims, active co-occupancy, operative rhythm timing, continuity, and unresolved gaps without repairing or releasing work.';

revoke all on function atlas.crop_cycle_reality_expression_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.crop_cycle_reality_expression_v1(uuid) to service_role;

insert into atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  registered_at,
  reviewed_at
) values (
  'atlas.crop_cycle_reality_expression_v1(uuid)',
  'service_internal',
  'verified',
  'active',
  false,
  false,
  true,
  0,
  0,
  jsonb_build_object(
    'purpose', 'Read one crop cycle through the Reality Expression contract without mutating or repairing it.',
    'boundary', 'Pass 1 is service/internal only. Owner and Worker surfaces must add their own jurisdiction-specific wrappers later.',
    'truthLaw', 'Conflicting witnesses, missing claims, co-occupancy, provenance gaps, and lawful future gates remain explicit outputs rather than being silently reconciled.'
  ),
  now(),
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
