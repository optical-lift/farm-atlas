create or replace function atlas.worker_weekly_farm_contract_v5(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_base jsonb;
  v_week_start date;
  v_week_end date;
  v_item jsonb;
  v_task atlas.tasks%rowtype;
  v_task_id uuid;
  v_traits jsonb;
  v_readiness jsonb;
  v_protection jsonb;
  v_consequence jsonb;
  v_decorated jsonb;
  v_work jsonb := '[]'::jsonb;
  v_sorted_work jsonb := '[]'::jsonb;
  v_required boolean;
  v_original_required boolean;
  v_promoted boolean;
  v_ready boolean;
  v_protected_state text;
  v_protected boolean;
  v_minutes integer;
  v_due date;
  v_occurrence_target date;
  v_required_count integer := 0;
  v_required_minutes integer := 0;
  v_required_unestimated integer := 0;
  v_required_readiness_risk integer := 0;
  v_required_consequence_unresolved integer := 0;
  v_required_dependency_missing integer := 0;
  v_optional_count integer := 0;
  v_optional_minutes integer := 0;
  v_protected_count integer := 0;
  v_protected_minutes integer := 0;
  v_protected_work jsonb := '[]'::jsonb;
  v_protection_unresolved_count integer := 0;
  v_protection_unresolved_minutes integer := 0;
  v_protection_unresolved_work jsonb := '[]'::jsonb;
  v_ordinary_required_count integer := 0;
  v_ordinary_required_minutes integer := 0;
  v_ordinary_required_work jsonb := '[]'::jsonb;
  v_blocked_protected_count integer := 0;
  v_blocked_protected_minutes integer := 0;
  v_blocked_protected_work jsonb := '[]'::jsonb;
  v_skipped_child_count integer := 0;
  v_trait_partial integer := 0;
  v_outdoor_heavy integer := 0;
  v_outdoor_light integer := 0;
  v_propagation integer := 0;
  v_venue integer := 0;
  v_admin integer := 0;
  v_morning integer := 0;
  v_afternoon integer := 0;
  v_evening integer := 0;
  v_can_fragment integer := 0;
  v_should_not_fragment integer := 0;
  v_planned_capacity integer;
  v_recovery_capacity integer;
  v_missing integer;
  v_state text;
begin
  v_base := atlas.worker_weekly_farm_contract_v4(p_farm_id, p_membership_id, p_anchor_day);
  v_week_start := (v_base->>'weekStart')::date;
  v_week_end := (v_base->>'weekEnd')::date;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_base->'work','[]'::jsonb))
  loop
    v_task_id := (v_item->>'taskId')::uuid;
    select * into v_task from atlas.tasks where id = v_task_id;
    if v_task.id is null then
      continue;
    end if;

    if v_task.parent_task_id is not null
       or nullif(v_task.metadata->>'parent_task_id','') is not null
       or lower(coalesce(v_task.metadata->>'is_child_task','false')) in ('true','yes','1') then
      v_skipped_child_count := v_skipped_child_count + 1;
      continue;
    end if;

    v_traits := atlas.task_clock_function_traits_v2(v_task_id, v_week_start);
    v_readiness := atlas.task_execution_readiness_v1(v_task_id);
    v_protection := atlas.task_protected_farm_minimum_v1(v_task_id, v_week_start);
    v_consequence := atlas.task_effective_delay_consequence_v1(v_task_id, v_week_start);

    v_original_required := coalesce((v_item->>'requiredThisWeek')::boolean, false);
    v_ready := coalesce((v_readiness->>'ready')::boolean, false);
    v_protected_state := v_protection->>'state';
    v_protected := coalesce((v_protection->>'protectedFarmMinimum')::boolean, false);
    v_minutes := coalesce((v_item->>'expectedActiveMinutes')::integer, 0);
    v_due := nullif(v_item->>'dueDate','')::date;
    v_occurrence_target := nullif(v_item->>'occurrenceTargetDate','')::date;

    v_promoted := not v_original_required
      and v_protected
      and v_ready
      and coalesce(v_due, v_occurrence_target, v_week_end) <= v_week_end;
    v_required := v_original_required or v_promoted;

    v_decorated := v_item || jsonb_build_object(
      'requiredThisWeek', v_required,
      'protectedFarmMinimum', v_protection->'protectedFarmMinimum',
      'protectedFarmMinimumState', v_protected_state,
      'protectedFarmMinimumCategory', v_protection->>'category',
      'protectedFarmMinimumSource', v_protection->>'source',
      'clockTraits', v_traits,
      'executionReadiness', v_readiness,
      'executionReady', v_ready,
      'protectedMinimumPromotedToRequired', v_promoted
    );

    if v_promoted then
      v_decorated := v_decorated || jsonb_build_object(
        'reasonCodes', coalesce(v_item->'reasonCodes','[]'::jsonb) || '["protected_farm_minimum"]'::jsonb
      );
    end if;

    v_work := v_work || jsonb_build_array(v_decorated);

    if v_protected and not v_ready then
      v_blocked_protected_count := v_blocked_protected_count + 1;
      v_blocked_protected_minutes := v_blocked_protected_minutes + greatest(v_minutes,0);
      v_blocked_protected_work := v_blocked_protected_work || jsonb_build_array(v_decorated);
    end if;

    if v_required then
      v_required_count := v_required_count + 1;
      if v_minutes > 0 then
        v_required_minutes := v_required_minutes + v_minutes;
      else
        v_required_unestimated := v_required_unestimated + 1;
      end if;

      if not v_ready then
        v_required_readiness_risk := v_required_readiness_risk + 1;
      end if;
      if coalesce((v_consequence->>'needsConsequenceResolution')::boolean, true) then
        v_required_consequence_unresolved := v_required_consequence_unresolved + 1;
      end if;
      if coalesce((v_consequence->>'dependencyLinkMissing')::boolean, false) then
        v_required_dependency_missing := v_required_dependency_missing + 1;
      end if;

      if v_protected_state = 'protected' then
        v_protected_count := v_protected_count + 1;
        v_protected_minutes := v_protected_minutes + greatest(v_minutes,0);
        v_protected_work := v_protected_work || jsonb_build_array(v_decorated);
      elsif v_protected_state = 'unresolved' then
        v_protection_unresolved_count := v_protection_unresolved_count + 1;
        v_protection_unresolved_minutes := v_protection_unresolved_minutes + greatest(v_minutes,0);
        v_protection_unresolved_work := v_protection_unresolved_work || jsonb_build_array(v_decorated);
      else
        v_ordinary_required_count := v_ordinary_required_count + 1;
        v_ordinary_required_minutes := v_ordinary_required_minutes + greatest(v_minutes,0);
        v_ordinary_required_work := v_ordinary_required_work || jsonb_build_array(v_decorated);
      end if;

      if v_traits->>'state' <> 'classified' then
        v_trait_partial := v_trait_partial + 1;
      end if;
      if (v_traits->'traitKeys') ? 'outdoor_heavy' then
        v_outdoor_heavy := v_outdoor_heavy + greatest(v_minutes,0);
      end if;
      if (v_traits->'traitKeys') ? 'outdoor_light' then
        v_outdoor_light := v_outdoor_light + greatest(v_minutes,0);
      end if;
      if (v_traits->'traitKeys') ? 'propagation' then
        v_propagation := v_propagation + greatest(v_minutes,0);
      end if;
      if (v_traits->'traitKeys') ? 'venue_bounded' then
        v_venue := v_venue + greatest(v_minutes,0);
      end if;
      if (v_traits->'traitKeys') ? 'farm_admin_call' then
        v_admin := v_admin + greatest(v_minutes,0);
      end if;

      if v_traits->>'dayWindow' = 'morning' then
        v_morning := v_morning + greatest(v_minutes,0);
      elsif v_traits->>'dayWindow' = 'afternoon' then
        v_afternoon := v_afternoon + greatest(v_minutes,0);
      elsif v_traits->>'dayWindow' = 'evening' then
        v_evening := v_evening + greatest(v_minutes,0);
      end if;

      if v_traits->>'fragmentation' = 'can_fragment' then
        v_can_fragment := v_can_fragment + greatest(v_minutes,0);
      elsif v_traits->>'fragmentation' = 'should_not_fragment' then
        v_should_not_fragment := v_should_not_fragment + greatest(v_minutes,0);
      end if;
    elsif v_ready then
      v_optional_count := v_optional_count + 1;
      if v_minutes > 0 then
        v_optional_minutes := v_optional_minutes + v_minutes;
      end if;
    end if;
  end loop;

  select coalesce(jsonb_agg(x.value order by
    coalesce((x.value->>'requiredThisWeek')::boolean,false) desc,
    coalesce((x.value->>'protectedFarmMinimum')::boolean,false) desc,
    case when coalesce(x.value->>'effectiveConsequenceTier','') ~ '^[1-6]$'
      then (x.value->>'effectiveConsequenceTier')::integer else 99 end,
    nullif(x.value->>'dueDate','')::date nulls last,
    x.value->>'title'
  ), '[]'::jsonb)
  into v_sorted_work
  from jsonb_array_elements(v_work) x(value);

  if coalesce(v_base->>'plannedCapacityMinutes','') ~ '^[0-9]+$' then
    v_planned_capacity := (v_base->>'plannedCapacityMinutes')::integer;
  end if;
  if coalesce(v_base->>'recoveryCapacityMinutes','') ~ '^[0-9]+$' then
    v_recovery_capacity := (v_base->>'recoveryCapacityMinutes')::integer;
  end if;
  if v_planned_capacity is not null and v_required_unestimated = 0 then
    v_missing := greatest(v_required_minutes - v_planned_capacity, 0);
  end if;

  v_state := case
    when coalesce((v_base->>'capacityPolicyConflictDays')::integer,0) > 0 then 'capacity_policy_conflict'
    when coalesce((v_base->>'capacityAnchorRequiredDays')::integer,0) > 0 then 'capacity_anchor_required'
    when v_required_unestimated > 0 then 'work_estimate_required'
    when v_required_readiness_risk > 0 then 'readiness_risk'
    when coalesce(v_missing,0) > 0 and v_required_minutes <= coalesce(v_planned_capacity,0) + coalesce(v_recovery_capacity,0) then 'recovery_required'
    when coalesce(v_missing,0) > 0 then 'capacity_conflict'
    else 'feasible'
  end;

  return v_base || jsonb_build_object(
    'contractVersion','worker_weekly_farm_contract_v5',
    'clockFunctionalTaxonomyVersion','task_clock_function_traits_v2',
    'executionReadinessContractVersion','task_execution_readiness_v1',
    'state',v_state,
    'weeklyFeasibilityKnown',v_state in ('feasible','readiness_risk','recovery_required','capacity_conflict'),
    'requiredWorkCount',v_required_count,
    'requiredEstimatedMinutes',v_required_minutes,
    'requiredUnestimatedCount',v_required_unestimated,
    'requiredReadinessRiskCount',v_required_readiness_risk,
    'requiredConsequenceUnresolvedCount',v_required_consequence_unresolved,
    'requiredDependencyLinkMissingCount',v_required_dependency_missing,
    'consequenceOrderingReady',v_required_consequence_unresolved=0,
    'optionalCandidateCount',v_optional_count,
    'optionalCandidateEstimatedMinutes',v_optional_minutes,
    'protectedFarmMinimumCount',v_protected_count,
    'protectedFarmMinimumEstimatedMinutes',v_protected_minutes,
    'protectedFarmMinimumWork',v_protected_work,
    'protectedFarmMinimumUnresolvedCount',v_protection_unresolved_count,
    'protectedFarmMinimumUnresolvedEstimatedMinutes',v_protection_unresolved_minutes,
    'protectedFarmMinimumUnresolvedWork',v_protection_unresolved_work,
    'protectedFarmMinimumClassificationReady',v_protection_unresolved_count=0,
    'blockedProtectedReadinessCount',v_blocked_protected_count,
    'blockedProtectedReadinessEstimatedMinutes',v_blocked_protected_minutes,
    'blockedProtectedReadinessWork',v_blocked_protected_work,
    'ordinaryRequiredWorkCount',v_ordinary_required_count,
    'ordinaryRequiredEstimatedMinutes',v_ordinary_required_minutes,
    'ordinaryRequiredWork',v_ordinary_required_work,
    'skippedChildTaskCount',v_skipped_child_count,
    'clockFunctionalTaxonomyReady',v_trait_partial=0,
    'requiredClockTraitPartialCount',v_trait_partial,
    'requiredOutdoorHeavyMinutes',v_outdoor_heavy,
    'requiredOutdoorLightMinutes',v_outdoor_light,
    'requiredPropagationMinutes',v_propagation,
    'requiredVenueBoundedMinutes',v_venue,
    'requiredFarmAdminCallMinutes',v_admin,
    'requiredDayWindowMinutes',jsonb_build_object('morning',v_morning,'afternoon',v_afternoon,'evening',v_evening),
    'requiredFragmentationMinutes',jsonb_build_object('canFragment',v_can_fragment,'shouldNotFragment',v_should_not_fragment),
    'missingPlannedCapacityMinutes',v_missing,
    'recoveryWouldCoverKnownShortfall',case when v_missing is not null then v_required_minutes <= coalesce(v_planned_capacity,0) + coalesce(v_recovery_capacity,0) else null end,
    'protectedFarmMinimumCapacityCoverageKnown',v_planned_capacity is not null and v_protection_unresolved_count=0,
    'protectedFarmMinimumFitsPlannedCapacity',case when v_planned_capacity is not null and v_protection_unresolved_count=0 then v_protected_minutes <= v_planned_capacity else null end,
    'protectedFarmMinimumCapacityShortfallMinutes',case when v_planned_capacity is not null and v_protection_unresolved_count=0 then greatest(v_protected_minutes-v_planned_capacity,0) else null end,
    'work',v_sorted_work
  );
end;
$$;

revoke all on function atlas.worker_weekly_farm_contract_v5(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.worker_weekly_farm_contract_v5(uuid,uuid,date) to service_role;

create or replace function atlas.owner_weekly_farm_contract_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  return atlas.worker_weekly_farm_contract_v5(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

create or replace function atlas.worker_self_weekly_farm_contract_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id
      and fm.user_id=auth.uid() and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'The Weekly Farm Contract may only be read by that active Farm Hand.' using errcode='42501';
  end if;
  return atlas.worker_weekly_farm_contract_v5(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

revoke all on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated, service_role;
revoke all on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated, service_role;