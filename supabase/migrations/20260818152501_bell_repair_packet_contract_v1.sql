create or replace function atlas.bell_repair_family_contract_v1(p_issue_key text)
returns jsonb
language sql
immutable security definer
set search_path to 'pg_catalog','atlas'
as $$
  select case p_issue_key
    when 'terminal_lifecycle_mismatch' then jsonb_build_object(
      'divergenceClass','lifecycle','owningDomain','farm_operations_reconciliation','owningFunction','reconcile_terminal_lifecycle','jurisdiction','management',
      'expectedTruth','Terminal evidence and lifecycle classification agree.','observedTruth','Terminal evidence exists while the subject remains lifecycle-active.',
      'consequence','Atlas can continue treating a finished body as living work and generate false continuity obligations.')
    when 'closure_uncovered' then jsonb_build_object(
      'divergenceClass','continuity','owningDomain','farm_operations','owningFunction','establish_closure_continuation','jurisdiction','management',
      'expectedTruth','A cleanup/closure state has a lawful closure operation, wait, or terminal classification.','observedTruth','A cleanup/closure state has no current task or future/gated occurrence.',
      'consequence','Closure work can silently disappear while the physical state remains unresolved.')
    when 'overdue_emergence_uncovered' then jsonb_build_object(
      'divergenceClass','propagation','owningDomain','farm_operations_propagation','owningFunction','inspect_overdue_emergence','jurisdiction','management',
      'expectedTruth','A living propagation body past its expected emergence window has inspection or next-state coverage.','observedTruth','The emergence window passed without a current task or lawful continuation.',
      'consequence','Living material can fail or change state without Atlas observing and reclassifying it.')
    when 'propagation_transition_uncovered' then jsonb_build_object(
      'divergenceClass','continuity','owningDomain','farm_operations_propagation','owningFunction','restore_propagation_continuity','jurisdiction','management',
      'expectedTruth','Transition-sensitive propagation states have current work, a future/gated occurrence, a lawful wait, or a terminal classification.','observedTruth','Living propagation material is transition-sensitive with no current or future continuation.',
      'consequence','A living body can remain real while its next required operation disappears from execution.')
    when 'future_seed_readiness_gap' then jsonb_build_object(
      'divergenceClass','input_warrant','owningDomain','production_inventory','owningFunction','establish_seed_inventory_warrant','jurisdiction','management',
      'expectedTruth','Allocated future production demand has trusted physical input coverage before the operation window arrives.','observedTruth','Future production demand exists without trusted seed inventory coverage.',
      'consequence','A planned sowing can reach its lawful window without a physically warranted input.')
    when 'production_field_continuity' then jsonb_build_object(
      'divergenceClass','production_continuity','owningDomain','production_planning','owningFunction','restore_field_continuity','jurisdiction','management',
      'expectedTruth','Production subjects retain a lawful field-state continuation from current reality to the next operation.','observedTruth','Production field continuity is incomplete or internally contradictory.',
      'consequence','Production can remain represented in planning while losing the path that makes the next field operation executable.')
    when 'future_reservation_release_path_gap' then jsonb_build_object(
      'divergenceClass','claim_release','owningDomain','production_capacity','owningFunction','establish_reservation_release_path','jurisdiction','management',
      'expectedTruth','Future reservations have a lawful release, conversion, or cancellation path.','observedTruth','A future reservation exists without a canonical release path.',
      'consequence','Capacity can remain claimed after the condition that justified the reservation changes or ends.')
    when 'complete_harvest_without_termination_path' then jsonb_build_object(
      'divergenceClass','lifecycle','owningDomain','farm_operations_continuity','owningFunction','close_harvested_cycle','jurisdiction','management',
      'expectedTruth','A completed harvest has a lawful termination, cleanup, regrowth, or next-cycle path.','observedTruth','Harvest is complete but lifecycle continuation/termination is absent.',
      'consequence','Atlas can preserve a harvested body as unfinished living work or lose required cleanup/regrowth work.')
    when 'actual_event_without_reforecast' then jsonb_build_object(
      'divergenceClass','reforecast','owningDomain','production_planning','owningFunction','reforecast_from_actual','jurisdiction','management',
      'expectedTruth','A material actual event reclassifies the affected Production forecast.','observedTruth','An actual production event exists without the corresponding reforecast.',
      'consequence','Future expectations can continue from superseded assumptions instead of the newly observed reality.')
    when 'missing_destination' then jsonb_build_object(
      'divergenceClass','destination','owningDomain','farm_operations_management','owningFunction','resolve_destination_claim','jurisdiction','management',
      'expectedTruth','A moving or future Production body has a canonical destination/capacity claim before execution release.','observedTruth','The subject exists but has no canonical destination claim.',
      'consequence','Existence or a date can be mistaken for executable availability even though there is nowhere lawfully claimed for the body to go.')
    when 'overclaimed_availability' then jsonb_build_object(
      'divergenceClass','claim','owningDomain','farm_operations_claims','owningFunction','reconcile_availability_claims','jurisdiction','management',
      'expectedTruth','Active claims do not exceed trusted available physical warrant.','observedTruth','Recorded active claims exceed the trusted available quantity.',
      'consequence','Multiple downstream obligations can be promised against capacity or inventory that does not exist.')
    when 'destination_collision' then jsonb_build_object(
      'divergenceClass','destination','owningDomain','farm_operations_management','owningFunction','resolve_destination_collision','jurisdiction','management',
      'expectedTruth','Destination claims are mutually compatible within trusted spatial/capacity warrant.','observedTruth','Two or more destination claims cannot all be satisfied by the same trusted destination capacity.',
      'consequence','Atlas can route multiple living bodies toward mutually impossible occupancy.')
    when 'committed_work_without_labor_capacity' then jsonb_build_object(
      'divergenceClass','capacity_claim','owningDomain','farm_operations_management','owningFunction','resolve_labor_capacity_claims','jurisdiction','management',
      'expectedTruth','Committed required work fits within canonical human-time and physical-load capacity.','observedTruth','Committed work exceeds the available labor claim surface.',
      'consequence','Required work cannot all be executed inside the claimed labor window; management must displace, defer, add capacity, or accept consequence.')
    when 'result_without_continuation' then jsonb_build_object(
      'divergenceClass','result_continuity','owningDomain','farm_operations_continuity','owningFunction','reconcile_result_to_next_state','jurisdiction','management',
      'expectedTruth','A material operation result reclassifies reality and leaves a lawful next state, wait, gate, or terminal state.','observedTruth','A result was recorded but no lawful continuation follows from it.',
      'consequence','Done can become a dead end: evidence exists, but the affected reality can silently disappear from future operations.')
    when 'orphaned_expected_next_stage' then jsonb_build_object(
      'divergenceClass','production_continuity','owningDomain','production_planning','owningFunction','restore_expected_next_stage','jurisdiction','management',
      'expectedTruth','An expected next Production stage is bound to a real subject and lawful continuation.','observedTruth','An expected next stage exists without a surviving subject/path that can lawfully enter it.',
      'consequence','Forecast state can imply future work that no longer has a real carrier.')
    when 'hardening_off_uncovered' then jsonb_build_object(
      'divergenceClass','destination','owningDomain','farm_operations_management','owningFunction','resolve_hardening_destination','jurisdiction','management',
      'expectedTruth','A hardening-off body has a destination claim or explicit resolution/reconciliation path.','observedTruth','The body is approaching move readiness without destination or governed resolution.',
      'consequence','A living body can reach transplant readiness with no lawful place or decision path.')
    when 'transplant_destination_unresolved' then jsonb_build_object(
      'divergenceClass','destination','owningDomain','farm_operations_management','owningFunction','resolve_transplant_destination','jurisdiction','management',
      'expectedTruth','A transplant operation has sufficient canonical destination coverage or an explicit management resolution path.','observedTruth','The transplant carrier lacks destination warrant and lacks governed continuation.',
      'consequence','A worker-facing transplant can imply execution authority that the physical destination does not support.')
    when 'no_lawful_next_state' then jsonb_build_object(
      'divergenceClass','continuity','owningDomain','farm_operations_continuity','owningFunction','resolve_lawful_next_state','jurisdiction','management',
      'expectedTruth','Every living subject has a lawful next operation, gate, wait, inspection, or terminal classification.','observedTruth','A living subject has no lawful next-state expression.',
      'consequence','The subject remains physically real while disappearing from Atlas execution and supervision.')
    else jsonb_build_object(
      'divergenceClass','unclassified','owningDomain','farm_operations_management','owningFunction','classify_repair_ownership','jurisdiction','management',
      'expectedTruth','The divergence has an explicit repair owner and lawful resolution path.','observedTruth','Atlas detected a divergence that is not yet mapped to a specific repair function.',
      'consequence','The exception can remain visible without anyone having lawful custody of the repair.')
  end;
$$;

create or replace function atlas.bell_repair_packets_v1(
  p_farm_id uuid,
  p_as_of_date date default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_date date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_audit jsonb;
  v_packets jsonb:='[]'::jsonb;
  v_family jsonb;
  v_contract jsonb;
  v_items jsonb;
  v_samples jsonb;
  v_issue_key text;
  v_severity text;
  v_count integer;
  v_subject_basis text;
  v_fingerprint text;
  v_conflict jsonb;
  v_member record;
  v_capacity_ids text;
  v_week_start text;
begin
  if not exists(select 1 from atlas.farms f where f.id=p_farm_id) then
    raise exception 'Farm not found.' using errcode='22023';
  end if;

  v_audit:=atlas.farm_continuity_audit_v4(p_farm_id,v_date);

  for v_family in select value from jsonb_array_elements(coalesce(v_audit->'issueFamilies','[]'::jsonb))
  loop
    v_issue_key:=v_family->>'key';
    v_severity:=coalesce(v_family->>'severity','medium');
    v_count:=coalesce((v_family->>'count')::integer,0);

    if v_count<=0 or v_severity='context' or v_issue_key='committed_work_without_labor_capacity' then
      continue;
    end if;

    v_contract:=atlas.bell_repair_family_contract_v1(v_issue_key);
    v_items:=coalesce(v_family->'items','[]'::jsonb);

    select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
      into v_samples
    from jsonb_array_elements(v_items) with ordinality x(item,ord)
    where ord<=8;

    select string_agg(subject_key,',' order by subject_key)
      into v_subject_basis
    from (
      select distinct coalesce(
        nullif(item->>'cropCycleId',''),nullif(item->>'cycleId',''),nullif(item->>'productionLotId',''),
        nullif(item->>'taskId',''),nullif(item->>'stableKey',''),nullif(item->>'cropCycleKey',''),md5(item::text)
      ) as subject_key
      from jsonb_array_elements(v_items) item
    ) q;

    v_fingerprint:=md5(concat_ws('|',v_issue_key,v_count::text,coalesce(v_contract->>'owningDomain',''),coalesce(v_contract->>'owningFunction',''),coalesce(v_subject_basis,'')));

    v_packets:=v_packets||jsonb_build_array(jsonb_build_object(
      'contractVersion','bell_repair_packet_v1',
      'repairKey','audit:'||v_issue_key,
      'fingerprint',v_fingerprint,
      'source',jsonb_build_object('kind','farm_continuity_audit','contractVersion',v_audit->>'contractVersion','issueFamily',v_issue_key,'asOfDate',v_date),
      'divergenceClass',v_contract->>'divergenceClass',
      'severity',v_severity,
      'itemCount',v_count,
      'title',case when v_count=1 then 'Repair reality divergence · '||replace(v_issue_key,'_',' ') else 'Repair '||v_count::text||' reality divergences · '||replace(v_issue_key,'_',' ') end,
      'observedTruth',v_contract->>'observedTruth',
      'expectedTruth',v_contract->>'expectedTruth',
      'differenceSummary',(v_contract->>'observedTruth')||' Expected: '||(v_contract->>'expectedTruth'),
      'consequence',v_contract->>'consequence',
      'owningFunction',jsonb_build_object('domain',v_contract->>'owningDomain','function',v_contract->>'owningFunction','jurisdiction',v_contract->>'jurisdiction'),
      'repairRoute',jsonb_build_object('surface','bell','recipientFunction',v_contract->>'owningDomain','humanActionRequired',true),
      'workerResponsibility',jsonb_build_object('state','not_assigned_by_divergence','principle','A divergence does not establish worker causation. Worker responsibility may be assigned only from separate causal evidence and jurisdiction.'),
      'sampleItems',v_samples,
      'drilldown',jsonb_build_object('function','atlas.farm_continuity_audit_v4','issueFamily',v_issue_key,'asOfDate',v_date),
      'truthBoundary',jsonb_build_object(
        'alertIsRepairRoutingNotBlame',true,
        'repairOwnerIsFunctionNotPerson',true,
        'visibilityDoesNotEstablishCausation',true,
        'governedContinuationIsNotDivergence',true,
        'principalEscalationNotCreated',true
      )
    ));
  end loop;

  for v_member in
    select fm.id,fm.worker_key,fm.role
    from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
    order by fm.id
  loop
    v_conflict:=atlas.worker_weekly_capacity_conflict_v2(p_farm_id,v_member.id,v_date);
    if not coalesce((v_conflict->>'hasCapacityConflict')::boolean,false) then
      continue;
    end if;

    v_week_start:=coalesce(v_conflict->>'weekStart',v_date::text);
    select string_agg(task_id,',' order by task_id) into v_capacity_ids
    from (
      select distinct coalesce(item->>'taskId','') task_id
      from jsonb_array_elements(coalesce(v_conflict->'downstreamConsequence','[]'::jsonb)) item
      where coalesce(item->>'taskId','')<>''
    ) q;
    v_fingerprint:=md5(concat_ws('|',v_member.id::text,v_week_start,coalesce(v_conflict->>'conflictClass',''),
      coalesce(v_conflict->>'missingPlannedCapacityMinutes','0'),coalesce(v_conflict->>'heavyLoadMissingPlannedMinutes','0'),coalesce(v_capacity_ids,'')));

    select coalesce(jsonb_agg(item order by ord),'[]'::jsonb) into v_samples
    from jsonb_array_elements(coalesce(v_conflict->'downstreamConsequence','[]'::jsonb)) with ordinality x(item,ord)
    where ord<=8;

    v_packets:=v_packets||jsonb_build_array(jsonb_build_object(
      'contractVersion','bell_repair_packet_v1',
      'repairKey','capacity:'||v_member.id::text||':'||v_week_start,
      'fingerprint',v_fingerprint,
      'source',jsonb_build_object('kind','worker_weekly_capacity_conflict','contractVersion',v_conflict->>'contractVersion','membershipId',v_member.id,'weekStart',v_week_start,'asOfDate',v_date),
      'divergenceClass','capacity_claim',
      'severity','high',
      'itemCount',jsonb_array_length(coalesce(v_conflict->'downstreamConsequence','[]'::jsonb)),
      'title','Repair weekly labor-capacity conflict',
      'observedTruth',format('Required labor claims exceed lawful capacity by %s planned minutes and %s heavy-load minutes.',coalesce(v_conflict->>'missingPlannedCapacityMinutes','0'),coalesce(v_conflict->>'heavyLoadMissingPlannedMinutes','0')),
      'expectedTruth','Fixed, protected, and required labor claims fit within canonical planned/recovery capacity and physical-load limits before optional work is admitted.',
      'differenceSummary','Required work cannot all fit inside the currently warranted labor-claim surface.',
      'consequence','Farm Operations must displace optional claims, defer lawful work, add capacity, or explicitly accept the downstream consequence before the week can be considered feasible.',
      'owningFunction',jsonb_build_object('domain','farm_operations_management','function','resolve_worker_weekly_capacity_conflict','jurisdiction','management'),
      'repairRoute',jsonb_build_object('surface','bell','recipientFunction','farm_operations_management','humanActionRequired',true),
      'workerResponsibility',jsonb_build_object('state','not_assigned_by_divergence','principle','Insufficient labor capacity is a management claim-allocation condition. It does not establish worker failure.'),
      'sampleItems',v_samples,
      'drilldown',jsonb_build_object('function','atlas.worker_weekly_capacity_conflict_v2','membershipId',v_member.id,'weekStart',v_week_start),
      'truthBoundary',jsonb_build_object(
        'managementConflictDoesNotCreatePrincipalWorkByItself',true,
        'estimateIsCapacityClaimNotLaborActual',true,
        'optionalWorkDisplacedBeforeRequiredWorkDeclaredImpossible',true,
        'workerBlameNotInferred',true,
        'principalEscalationNotCreated',true
      )
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','bell_repair_packets_v1',
    'farmId',p_farm_id,
    'asOfDate',v_date,
    'state',case when jsonb_array_length(v_packets)>0 then 'repair_divergences_present' else 'no_repair_divergence_detected' end,
    'packetCount',jsonb_array_length(v_packets),
    'packets',v_packets,
    'truthBoundary',jsonb_build_object(
      'bellRepresentsRepairCustodyNotWorkerBlame',true,
      'contextAndGovernedContinuationAreExcluded',true,
      'capacityConflictUsesCanonicalWeeklyClaimContract',true,
      'principalEscalationCreated',false
    )
  );
end;
$$;

revoke all on function atlas.bell_repair_family_contract_v1(text) from public,anon,authenticated;
revoke all on function atlas.bell_repair_packets_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.bell_repair_family_contract_v1(text) to service_role;
grant execute on function atlas.bell_repair_packets_v1(uuid,date) to service_role;

comment on function atlas.bell_repair_packets_v1(uuid,date) is
'Phase 13 read-only Bell repair translation. Converts live continuity/destination/claim/result/input/capacity divergences into function-owned repair packets. Divergence visibility never establishes worker blame and never creates Principal work by itself.';