create or replace function atlas.farm_continuity_audit_v1(
  p_farm_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_day date := coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_timezone text := 'America/Chicago';
  v_active_cycles integer := 0;
  v_current_covered integer := 0;
  v_future_covered integer := 0;
  v_background_observations integer := 0;
  v_terminal_count integer := 0;
  v_hardening_count integer := 0;
  v_closure_count integer := 0;
  v_propagation_gap_count integer := 0;
  v_overdue_emergence_count integer := 0;
  v_destination_count integer := 0;
  v_seed_readiness_count integer := 0;
  v_field_continuity_count integer := 0;
  v_reservation_gap_count integer := 0;
  v_high_count integer := 0;
  v_medium_count integer := 0;
  v_terminal_items jsonb := '[]'::jsonb;
  v_hardening_items jsonb := '[]'::jsonb;
  v_closure_items jsonb := '[]'::jsonb;
  v_propagation_items jsonb := '[]'::jsonb;
  v_overdue_emergence_items jsonb := '[]'::jsonb;
  v_destination_items jsonb := '[]'::jsonb;
  v_seed_readiness_items jsonb := '[]'::jsonb;
  v_field_continuity_items jsonb := '[]'::jsonb;
  v_reservation_gap_items jsonb := '[]'::jsonb;
  v_state text;
begin
  if p_farm_id is null then
    raise exception 'A farm is required.' using errcode='22023';
  end if;

  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
    into v_timezone
  from atlas.farms f
  where f.id=p_farm_id;

  with active_cycles as (
    select
      cc.*,
      z.stable_key as zone_key,
      go.label as object_label
    from atlas.crop_cycles cc
    left join atlas.growing_objects go on go.id=cc.object_id
    left join atlas.zones z on z.id=go.zone_id
    where cc.farm_id=p_farm_id
      and coalesce(cc.lifecycle_status,'active')='active'
  ), coverage as (
    select c.id,
      exists (
        select 1
        from atlas.tasks t
        where t.farm_id=c.farm_id
          and t.status in ('open','blocked')
          and (
            exists(select 1 from atlas.task_crop_cycles tc where tc.task_id=t.id and tc.crop_cycle_id=c.id)
            or t.metadata->>'crop_cycle_id'=c.id::text
            or coalesce(t.metadata->'crop_cycle_ids','[]'::jsonb) ? c.id::text
          )
      ) as has_current_task,
      exists (
        select 1
        from atlas.planned_work_occurrences o
        where o.farm_id=c.farm_id
          and o.state in ('planned','eligible','released')
          and (
            (o.source_kind='crop_cycle' and o.source_id=c.id)
            or exists (
              select 1
              from atlas.tasks t
              where t.id=o.released_task_id
                and (
                  exists(select 1 from atlas.task_crop_cycles tc where tc.task_id=t.id and tc.crop_cycle_id=c.id)
                  or t.metadata->>'crop_cycle_id'=c.id::text
                  or coalesce(t.metadata->'crop_cycle_ids','[]'::jsonb) ? c.id::text
                )
            )
          )
      ) as has_future_occurrence
    from active_cycles c
  ), classified as (
    select
      c.*,
      cov.has_current_task,
      cov.has_future_occurrence,
      case
        when c.cycle_state in ('failed','failed_germination','abandoned','absent','archived') then 'terminal_lifecycle_mismatch'
        when c.zone_key='grow_room' and c.cycle_state='hardening_off'
          and not cov.has_current_task and not cov.has_future_occurrence then 'hardening_off_uncovered'
        when c.zone_key='grow_room' and c.cycle_state in ('cleanup_needed','declining')
          and not cov.has_current_task and not cov.has_future_occurrence then 'closure_uncovered'
        when c.zone_key='grow_room' and c.cycle_state='sown_awaiting_emergence'
          and c.expected_germination_end is not null and c.expected_germination_end < v_day
          and not cov.has_current_task and not cov.has_future_occurrence then 'overdue_emergence_uncovered'
        when c.zone_key='grow_room' and c.cycle_state in ('germinated','seedling_care','propagation')
          and not cov.has_current_task and not cov.has_future_occurrence then 'propagation_transition_uncovered'
        when cov.has_current_task then 'current_work_covered'
        when cov.has_future_occurrence then 'future_gated_covered'
        else 'continuity_observation'
      end as continuity_state
    from active_cycles c
    join coverage cov using(id)
  )
  select
    count(*)::integer,
    count(*) filter(where continuity_state='current_work_covered')::integer,
    count(*) filter(where continuity_state='future_gated_covered')::integer,
    count(*) filter(where continuity_state='continuity_observation')::integer,
    count(*) filter(where continuity_state='terminal_lifecycle_mismatch')::integer,
    count(*) filter(where continuity_state='hardening_off_uncovered')::integer,
    count(*) filter(where continuity_state='closure_uncovered')::integer,
    count(*) filter(where continuity_state='propagation_transition_uncovered')::integer,
    count(*) filter(where continuity_state='overdue_emergence_uncovered')::integer,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'cycleId',id,'cropLabel',crop_label,'variety',variety,'cycleState',cycle_state,
      'lifecycleStatus',lifecycle_status,'zoneKey',zone_key,'objectLabel',object_label,
      'repairOwner','farm_operations_data','reason','Cycle remains lifecycle-active while its state is terminal.'
    )) order by crop_label,variety nulls last) filter(where continuity_state='terminal_lifecycle_mismatch'),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'cycleId',id,'cropLabel',crop_label,'variety',variety,'cycleState',cycle_state,
      'zoneKey',zone_key,'objectLabel',object_label,'repairOwner','farm_operations_management',
      'reason','Hardening-off material has no current task or future/gated occurrence covering its next transition.'
    )) order by crop_label,variety nulls last) filter(where continuity_state='hardening_off_uncovered'),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'cycleId',id,'cropLabel',crop_label,'variety',variety,'cycleState',cycle_state,
      'zoneKey',zone_key,'objectLabel',object_label,'repairOwner','farm_operations',
      'reason','Closure/cleanup state has no current task or future/gated occurrence.'
    )) order by crop_label,variety nulls last) filter(where continuity_state='closure_uncovered'),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'cycleId',id,'cropLabel',crop_label,'variety',variety,'cycleState',cycle_state,
      'zoneKey',zone_key,'objectLabel',object_label,'expectedGerminationEnd',expected_germination_end,
      'repairOwner','farm_operations_propagation','reason','Living Grow Room material is in a transition-sensitive state with no current task or future/gated occurrence.'
    )) order by crop_label,variety nulls last) filter(where continuity_state='propagation_transition_uncovered'),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'cycleId',id,'cropLabel',crop_label,'variety',variety,'cycleState',cycle_state,
      'zoneKey',zone_key,'objectLabel',object_label,'expectedGerminationEnd',expected_germination_end,
      'repairOwner','farm_operations_propagation','reason','Expected germination window has passed with no current task or future/gated occurrence.'
    )) order by crop_label,variety nulls last) filter(where continuity_state='overdue_emergence_uncovered'),'[]'::jsonb)
  into
    v_active_cycles,v_current_covered,v_future_covered,v_background_observations,
    v_terminal_count,v_hardening_count,v_closure_count,v_propagation_gap_count,v_overdue_emergence_count,
    v_terminal_items,v_hardening_items,v_closure_items,v_propagation_items,v_overdue_emergence_items
  from classified;

  select
    count(*)::integer,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'taskId',t.id,'title',t.title,'dueDate',t.due_date,
      'destinationReadiness',atlas.task_execution_destination_readiness_v1(t.id),
      'protectedFarmMinimum',atlas.task_protected_farm_minimum_v1(t.id,v_day),
      'repairOwner','farm_operations_management',
      'reason','Final transplant execution is blocked until a canonical destination is resolved.'
    )) order by t.due_date nulls last,t.title),'[]'::jsonb)
  into v_destination_count,v_destination_items
  from atlas.tasks t
  join atlas.zones z on z.id=t.zone_id
  where t.farm_id=p_farm_id
    and t.status in ('open','blocked')
    and t.task_type='transplanting'
    and z.stable_key='grow_room'
    and coalesce((atlas.task_execution_destination_readiness_v1(t.id)->>'ready')::boolean,false)=false;

  select
    count(*) filter(where coalesce(all_seed_allocations_ready,false)=false and outstanding_allocated_quantity>0)::integer,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'productionLotId',production_lot_id,'lotLabel',lot_label,'plannedSowDate',planned_sow_date,
      'outstandingAllocatedQuantity',outstanding_allocated_quantity,'trustedCoveredQuantity',trusted_covered_quantity,
      'blockingReason',blocking_reason,'repairOwner','production_inventory',
      'reason','Future production lot has allocated seed demand without trusted inventory coverage.'
    )) order by planned_sow_date,lot_label)
      filter(where coalesce(all_seed_allocations_ready,false)=false and outstanding_allocated_quantity>0),'[]'::jsonb)
  into v_seed_readiness_count,v_seed_readiness_items
  from atlas.production_seed_readiness_v1
  where farm_id=p_farm_id;

  select
    count(*) filter(where audit_status<>'pass')::integer,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'productionLotId',production_lot_id,'lotLabel',lot_label,'currentStage',current_stage,
      'lifecycleStatus',lifecycle_status,'auditStatus',audit_status,
      'missingFieldStandCount',missing_field_stand_count,
      'missingFieldCareStateCount',missing_field_care_state_count,
      'missingCarePolicyCount',missing_care_policy_count,
      'harvestGateStatus',harvest_gate_status,
      'repairOwner','production_systems'
    )) order by lot_label) filter(where audit_status<>'pass'),'[]'::jsonb)
  into v_field_continuity_count,v_field_continuity_items
  from atlas.production_field_continuity_audit_v1
  where farm_id=p_farm_id;

  select
    count(*)::integer,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'reservationId',r.id,'productionLotId',r.production_lot_id,'windowStart',r.window_start,'windowEnd',r.window_end,
      'capacityPoolId',r.capacity_pool_id,'quantityReserved',r.quantity_reserved,'unit',r.unit,
      'repairOwner','production_systems','reason','Active future capacity reservation has no active production-lot lifecycle path.'
    )) order by r.window_start),'[]'::jsonb)
  into v_reservation_gap_count,v_reservation_gap_items
  from atlas.production_capacity_reservations r
  left join atlas.production_lots pl on pl.id=r.production_lot_id
  where r.farm_id=p_farm_id
    and coalesce(r.reservation_status,'active') not in ('released','cancelled','expired')
    and (pl.id is null or coalesce(pl.lifecycle_status,'') in ('cancelled','failed','complete','completed','archived'));

  v_high_count := v_terminal_count + v_hardening_count + v_closure_count + v_overdue_emergence_count + v_destination_count;
  v_medium_count := v_propagation_gap_count + v_seed_readiness_count + v_field_continuity_count + v_reservation_gap_count;

  v_state := case
    when v_high_count>0 then 'high_priority_continuity_attention'
    when v_medium_count>0 then 'continuity_attention'
    else 'no_actionable_continuity_gap_detected'
  end;

  return jsonb_build_object(
    'contractVersion','farm_continuity_audit_v1',
    'farmId',p_farm_id,
    'asOfDate',v_day,
    'timezone',v_timezone,
    'state',v_state,
    'farmTruthMutated',false,
    'principalEscalationCreated',false,
    'principalBoundary','Issues remain contained in Farm Operations unless an explicit escalation threshold is crossed.',
    'summary',jsonb_build_object(
      'activeCropCycleCount',v_active_cycles,
      'currentWorkCoveredCount',v_current_covered,
      'futureGatedCoveredCount',v_future_covered,
      'backgroundContinuityObservationCount',v_background_observations,
      'highPriorityIssueCount',v_high_count,
      'mediumPriorityIssueCount',v_medium_count,
      'terminalLifecycleMismatchCount',v_terminal_count,
      'hardeningOffUncoveredCount',v_hardening_count,
      'closureUncoveredCount',v_closure_count,
      'overdueEmergenceUncoveredCount',v_overdue_emergence_count,
      'propagationTransitionUncoveredCount',v_propagation_gap_count,
      'transplantDestinationUnresolvedCount',v_destination_count,
      'futureSeedReadinessGapCount',v_seed_readiness_count,
      'productionFieldContinuityIssueCount',v_field_continuity_count,
      'futureReservationReleasePathGapCount',v_reservation_gap_count
    ),
    'issueFamilies',jsonb_build_array(
      jsonb_build_object('key','terminal_lifecycle_mismatch','severity','high','count',v_terminal_count,'items',v_terminal_items),
      jsonb_build_object('key','hardening_off_uncovered','severity','high','count',v_hardening_count,'items',v_hardening_items),
      jsonb_build_object('key','closure_uncovered','severity','high','count',v_closure_count,'items',v_closure_items),
      jsonb_build_object('key','overdue_emergence_uncovered','severity','high','count',v_overdue_emergence_count,'items',v_overdue_emergence_items),
      jsonb_build_object('key','transplant_destination_unresolved','severity','high','count',v_destination_count,'items',v_destination_items),
      jsonb_build_object('key','propagation_transition_uncovered','severity','medium','count',v_propagation_gap_count,'items',v_propagation_items),
      jsonb_build_object('key','future_seed_readiness_gap','severity','medium','count',v_seed_readiness_count,'items',v_seed_readiness_items),
      jsonb_build_object('key','production_field_continuity','severity','medium','count',v_field_continuity_count,'items',v_field_continuity_items),
      jsonb_build_object('key','future_reservation_release_path_gap','severity','medium','count',v_reservation_gap_count,'items',v_reservation_gap_items)
    ),
    'auditCoverage',jsonb_build_object(
      'livingCropNextState','active_current_and_legacy_crop_cycles',
      'propagationDestination','active_grow_room_transition_states_plus_task_destination_readiness',
      'futureSeedSourceInventory','production_seed_readiness_v1',
      'fieldProductionLotContinuity','production_field_continuity_audit_v1',
      'futureCapacityReservationReleasePath','audited',
      'targetWithoutSufficientLots','not_fully_auditable_yet',
      'lotWithoutSufficientLandOrLabor','not_fully_auditable_yet',
      'harvestEndToTermination','partial_until_harvest_lifecycle_and_legacy_cycles_are_fully_unified'
    ),
    'backgroundContinuityObservationPolicy','Stable/background cycles without a direct task or occurrence are counted separately and are not treated as immediate Worker Day or Principal alarms.'
  );
end;
$function$;

revoke all on function atlas.farm_continuity_audit_v1(uuid,date) from public;
grant execute on function atlas.farm_continuity_audit_v1(uuid,date) to authenticated;
grant execute on function atlas.farm_continuity_audit_v1(uuid,date) to service_role;