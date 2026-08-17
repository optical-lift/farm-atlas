create or replace function atlas.principal_self_context_api_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal atlas.principals%rowtype;
  v_household jsonb;
  v_portfolio jsonb;
  v_candidates jsonb;
  v_day date;
  v_clock jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  select * into v_principal
  from atlas.principals p
  where p.user_id=auth.uid() and p.status='active'
  limit 1;

  if v_principal.id is null then
    return jsonb_build_object(
      'contractVersion','principal_self_context_v1',
      'state','principal_required'
    );
  end if;

  v_day := (now() at time zone coalesce(nullif(v_principal.home_timezone,''),'America/Chicago'))::date;

  select to_jsonb(h)
  into v_household
  from atlas.households h
  where h.id=v_principal.active_household_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,
    'stableKey',u.stable_key,
    'name',u.name,
    'unitKind',u.unit_kind,
    'linkedFarmId',u.linked_farm_id,
    'lifecycleState',u.lifecycle_state,
    'portfolioRole',u.portfolio_role,
    'horizon',u.horizon,
    'archivedAt',u.archived_at
  ) order by case u.horizon when 'H1' then 1 when 'H2' then 2 else 3 end,u.name),'[]'::jsonb)
  into v_portfolio
  from atlas.portfolio_units u
  where u.owner_id=v_principal.id and u.archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'domain',c.domain,
    'sourceType',c.source_type,
    'sourceId',c.source_id,
    'title',c.title,
    'floorClass',c.floor_class,
    'windowStart',c.window_start,
    'windowEnd',c.window_end,
    'fixedStart',c.fixed_start,
    'mustBeginBy',c.must_begin_by,
    'mustFinishBy',c.must_finish_by,
    'expectedMinutes',c.expected_minutes,
    'protectionLevel',c.protection_level,
    'ownerRequired',c.owner_required,
    'consequence',c.consequence,
    'reasonForFloor',c.reason_for_floor,
    'portfolioUnitId',c.portfolio_unit_id,
    'horizon',c.horizon
  ) order by c.floor_class,c.window_end nulls last,c.title),'[]'::jsonb)
  into v_candidates
  from atlas.principal_clock_candidates_v1 c
  where c.principal_id=v_principal.id;

  v_clock := atlas.principal_clock_api_v1(v_day, now());

  return jsonb_build_object(
    'contractVersion','principal_self_context_v1',
    'state','ready',
    'principal',jsonb_build_object(
      'id',v_principal.id,
      'stableKey',v_principal.stable_key,
      'name',v_principal.name,
      'organizationId',v_principal.organization_id,
      'homeTimezone',v_principal.home_timezone,
      'activeHouseholdId',v_principal.active_household_id
    ),
    'household',v_household,
    'portfolioUnits',v_portfolio,
    'clockCandidatesMode','raw_inventory_not_arbitration',
    'clockCandidates',v_candidates,
    'principalClock',v_clock,
    'capacityToday',atlas.principal_capacity_day_state_v1(v_principal.id,v_day)
  );
end;
$function$;

revoke all on function atlas.principal_self_context_api_v1() from public, anon, authenticated, service_role;
grant execute on function atlas.principal_self_context_api_v1() to authenticated, service_role, postgres;

comment on function atlas.principal_self_context_api_v1() is
'Principal self-context. clockCandidates remains raw normalized inventory for compatibility; principalClock is the authoritative explainable arbitration contract.';