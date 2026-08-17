create or replace function atlas.worker_weekly_farm_contract_v2(
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
  v_item jsonb;
  v_protection jsonb;
  v_decorated jsonb;
  v_work jsonb:='[]'::jsonb;
  v_protected_work jsonb:='[]'::jsonb;
  v_remaining_required jsonb:='[]'::jsonb;
  v_unresolved_work jsonb:='[]'::jsonb;
  v_protected_count integer:=0;
  v_protected_minutes integer:=0;
  v_ordinary_required_count integer:=0;
  v_ordinary_required_minutes integer:=0;
  v_unresolved_count integer:=0;
  v_unresolved_minutes integer:=0;
  v_planned_capacity integer;
  v_capacity_known boolean:=false;
  v_protected_shortfall integer;
begin
  v_base:=atlas.worker_weekly_farm_contract_v1(p_farm_id,p_membership_id,p_anchor_day);
  v_week_start:=(v_base->>'weekStart')::date;

  if coalesce(v_base->>'plannedCapacityMinutes','') ~ '^[0-9]+$' then
    v_planned_capacity:=(v_base->>'plannedCapacityMinutes')::integer;
    v_capacity_known:=true;
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_base->'work','[]'::jsonb))
  loop
    v_protection:=atlas.task_protected_farm_minimum_v1((v_item->>'taskId')::uuid,v_week_start);
    v_decorated:=v_item||jsonb_build_object(
      'protectedFarmMinimum',v_protection->'protectedFarmMinimum',
      'protectedFarmMinimumState',v_protection->>'state',
      'protectedFarmMinimumCategory',v_protection->>'category',
      'protectedFarmMinimumSource',v_protection->>'source',
      'protectedFarmMinimumConfidence',v_protection->>'confidence',
      'protectedFarmMinimumDependencyLinkRepairNeeded',coalesce((v_protection->>'dependencyLinkRepairNeeded')::boolean,false)
    );
    v_work:=v_work||jsonb_build_array(v_decorated);

    if coalesce((v_item->>'requiredThisWeek')::boolean,false) then
      if v_protection->>'state'='protected' then
        v_protected_work:=v_protected_work||jsonb_build_array(v_decorated);
        v_protected_count:=v_protected_count+1;
        v_protected_minutes:=v_protected_minutes+coalesce((v_item->>'expectedActiveMinutes')::integer,0);
      elsif v_protection->>'state'='unresolved' then
        v_unresolved_work:=v_unresolved_work||jsonb_build_array(v_decorated);
        v_unresolved_count:=v_unresolved_count+1;
        v_unresolved_minutes:=v_unresolved_minutes+coalesce((v_item->>'expectedActiveMinutes')::integer,0);
      else
        v_remaining_required:=v_remaining_required||jsonb_build_array(v_decorated);
        v_ordinary_required_count:=v_ordinary_required_count+1;
        v_ordinary_required_minutes:=v_ordinary_required_minutes+coalesce((v_item->>'expectedActiveMinutes')::integer,0);
      end if;
    end if;
  end loop;

  if v_capacity_known and v_unresolved_count=0 then
    v_protected_shortfall:=greatest(v_protected_minutes-v_planned_capacity,0);
  end if;

  return v_base||jsonb_build_object(
    'contractVersion','worker_weekly_farm_contract_v2',
    'protectedFarmMinimumContractVersion','task_protected_farm_minimum_v1',
    'protectedFarmMinimumRule','protected biological/living/prerequisite work survives disruption and precedes event or side-project capacity',
    'protectedFarmMinimumCount',v_protected_count,
    'protectedFarmMinimumEstimatedMinutes',v_protected_minutes,
    'protectedFarmMinimumWork',v_protected_work,
    'protectedFarmMinimumUnresolvedCount',v_unresolved_count,
    'protectedFarmMinimumUnresolvedEstimatedMinutes',v_unresolved_minutes,
    'protectedFarmMinimumUnresolvedWork',v_unresolved_work,
    'protectedFarmMinimumClassificationReady',v_unresolved_count=0,
    'ordinaryRequiredWorkCount',v_ordinary_required_count,
    'ordinaryRequiredEstimatedMinutes',v_ordinary_required_minutes,
    'ordinaryRequiredWork',v_remaining_required,
    'protectedFarmMinimumCapacityCoverageKnown',v_capacity_known and v_unresolved_count=0,
    'protectedFarmMinimumFitsPlannedCapacity',case when v_capacity_known and v_unresolved_count=0 then v_protected_minutes<=v_planned_capacity else null end,
    'protectedFarmMinimumCapacityShortfallMinutes',v_protected_shortfall,
    'work',v_work
  );
end;
$$;

revoke all on function atlas.worker_weekly_farm_contract_v2(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.worker_weekly_farm_contract_v2(uuid,uuid,date) to service_role;

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
  return atlas.worker_weekly_farm_contract_v2(p_farm_id,p_membership_id,p_anchor_day);
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
  return atlas.worker_weekly_farm_contract_v2(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

revoke all on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated, service_role;
revoke all on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated, service_role;