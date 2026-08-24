create or replace function atlas.resolve_platform_work_scope_v1(
  p_operating_unit_kind text,
  p_operating_unit_id uuid,
  p_operating_unit_membership_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_kind text := lower(nullif(btrim(p_operating_unit_kind),''));
  v_farm atlas.farms%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_org_membership atlas.organization_memberships%rowtype;
  v_timezone text := 'America/Chicago';
begin
  if v_kind is null or p_operating_unit_id is null or p_operating_unit_membership_id is null then
    raise exception 'Operating unit kind, operating unit, and membership are required.' using errcode='22023';
  end if;

  if v_kind <> 'farm' then
    raise exception 'Unsupported operating unit kind: %', v_kind using errcode='22023';
  end if;

  select f.* into v_farm
  from atlas.farms f
  where f.id=p_operating_unit_id
    and f.status='active';

  if not found or v_farm.organization_id is null then
    raise exception 'Active operating unit with organization scope required.' using errcode='P0002';
  end if;

  select fm.* into v_membership
  from atlas.farm_memberships fm
  where fm.id=p_operating_unit_membership_id
    and fm.farm_id=p_operating_unit_id
    and fm.active=true;

  if not found then
    raise exception 'Active operating-unit membership required.' using errcode='P0002';
  end if;

  select om.* into v_org_membership
  from atlas.organization_memberships om
  where om.organization_id=v_farm.organization_id
    and om.user_id=v_membership.user_id
    and om.active=true
  order by om.updated_at desc nulls last, om.created_at desc nulls last, om.id
  limit 1;

  if not found then
    raise exception 'Active organization membership required for operating-unit membership.' using errcode='P0002';
  end if;

  v_timezone := coalesce(nullif(v_farm.metadata->>'timezone',''),'America/Chicago');

  return jsonb_build_object(
    'contractVersion','platform_work_scope_v1',
    'organizationId',v_farm.organization_id,
    'organizationMembershipId',v_org_membership.id,
    'organizationRole',v_org_membership.role,
    'operatingUnitKind',v_kind,
    'operatingUnitId',v_farm.id,
    'operatingUnitMembershipId',v_membership.id,
    'operatingUnitRole',v_membership.role,
    'userId',v_membership.user_id,
    'timezone',v_timezone
  );
end;
$$;

revoke all on function atlas.resolve_platform_work_scope_v1(text,uuid,uuid) from public,anon,authenticated;
grant execute on function atlas.resolve_platform_work_scope_v1(text,uuid,uuid) to service_role;

insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected,
  service_execute_expected, caller_count, policy_reference_count,
  evidence, anonymous_execute_expected
)
values (
  'atlas.resolve_platform_work_scope_v1(text, uuid, uuid)',
  'service_internal','verified','revoked',false,true,true,1,0,
  jsonb_build_object(
    'source','platform_work_scope_adapter_v1',
    'purpose','Platform organization to operating-unit membership resolver; internal adapter, not application RPC',
    'initialOperatingUnitKinds',jsonb_build_array('farm')
  ),false
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  anonymous_execute_expected=excluded.anonymous_execute_expected;

insert into atlas.productization_surface_classifications
  (family_key, classification, function_name_pattern, canonical_owner, domain_key, tenant_key, portability_state, authority_bearing, rationale, metadata)
values (
  'platform_work_scope','platform','^resolve_platform_work_scope_','platform_scope',null,null,'needs_generalization',true,
  'Platform work scope binds organization, operating unit, and membership without pretending the farm operating unit is itself the tenant boundary.',
  jsonb_build_object('initialOperatingUnitKinds',jsonb_build_array('farm'),'nextGeneralization','add adapters only when another operating-unit domain is real')
)
on conflict (family_key) do update set
  classification=excluded.classification,
  function_name_pattern=excluded.function_name_pattern,
  canonical_owner=excluded.canonical_owner,
  domain_key=excluded.domain_key,
  tenant_key=excluded.tenant_key,
  portability_state=excluded.portability_state,
  authority_bearing=excluded.authority_bearing,
  rationale=excluded.rationale,
  governing_source=excluded.governing_source,
  reviewed_at=now(),
  metadata=excluded.metadata;

create or replace function atlas.productization_surface_classification_audit_v1()
returns jsonb
language sql
security definer
set search_path = pg_catalog, atlas
as $$
with candidate_functions as (
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname ~ '^(principal_|worker_(day|self)_|farm_clock_|crop_|harvest_|grow_room_|owner_operator_|owner_needs_from_you|truth_acquisition_|requirement_|resolve_platform_work_scope_)'
), matches as (
  select f.proname, c.family_key, c.classification, c.portability_state
  from candidate_functions f
  join atlas.productization_surface_classifications c
    on c.function_name_pattern is not null
   and f.proname ~ c.function_name_pattern
), rollup as (
  select
    (select count(*) from candidate_functions) as candidate_count,
    (select count(distinct proname) from matches) as classified_count,
    (select count(*) from (select proname from matches group by proname having count(*) > 1) x) as overlap_count,
    (select coalesce(jsonb_agg(proname order by proname),'[]'::jsonb)
       from candidate_functions f
      where not exists (select 1 from matches m where m.proname=f.proname)) as unclassified,
    (select coalesce(jsonb_agg(jsonb_build_object('family',family_key,'classification',classification,'portabilityState',portability_state,'functionCount',cnt) order by family_key),'[]'::jsonb)
       from (select family_key, classification, portability_state, count(distinct proname) cnt from matches group by 1,2,3) s) as families
)
select jsonb_build_object(
  'status', case when candidate_count=classified_count and overlap_count=0 then 'sound' else 'review_required' end,
  'candidateFunctionCount', candidate_count,
  'classifiedFunctionCount', classified_count,
  'overlapCount', overlap_count,
  'unclassifiedFunctions', unclassified,
  'families', families
)
from rollup;
$$;

create or replace function atlas.worker_day_shape_effective_v1(p_farm_id uuid, p_membership_id uuid, p_day date)
returns jsonb
language plpgsql
stable security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_scope jsonb;
  v_timezone text:='America/Chicago';
  v_policy_count integer:=0;
  v_policy atlas.worker_day_shape_policies%rowtype;
  v_active_target integer:=0;
  v_configured_max integer:=0;
  v_expected_elapsed integer:=0;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_is_working_weekday boolean:=false;
begin
  if p_day is null then raise exception 'A service date is required.' using errcode='22023'; end if;

  v_scope:=atlas.resolve_platform_work_scope_v1('farm',p_farm_id,p_membership_id);
  v_timezone:=coalesce(nullif(v_scope->>'timezone',''),'America/Chicago');

  select coalesce(mcs.regular_target_minutes,0),coalesce(mcs.maximum_planned_minutes,0),
         coalesce(nullif(mcs.metadata->>'elapsed_workday_minutes','')::integer,0)
  into v_active_target,v_configured_max,v_expected_elapsed
  from atlas.member_capacity_settings mcs
  where mcs.farm_id=p_farm_id and mcs.membership_id=p_membership_id and mcs.active=true
  order by mcs.updated_at desc nulls last,mcs.created_at desc nulls last limit 1;

  select count(*)::integer into v_policy_count
  from atlas.worker_day_shape_policies policy
  where policy.farm_id=p_farm_id
    and policy.membership_id=p_membership_id
    and policy.active=true
    and policy.effective_from<=p_day
    and (policy.effective_through is null or policy.effective_through>=p_day);

  if v_policy_count=0 then
    return jsonb_build_object(
      'contractVersion','worker_day_shape_effective_v1','serviceDate',p_day,
      'state','anchor_required','requiresOwnerDayShape',true,'timezone',v_timezone,
      'configuredActiveTargetMinutes',v_active_target,
      'configuredMaximumPlannedMinutes',v_configured_max,
      'expectedElapsedWorkdayMinutes',v_expected_elapsed,'matchingPolicyCount',0
    );
  elsif v_policy_count>1 then
    return jsonb_build_object(
      'contractVersion','worker_day_shape_effective_v1','serviceDate',p_day,
      'state','policy_conflict','requiresOwnerDayShape',true,'timezone',v_timezone,
      'configuredActiveTargetMinutes',v_active_target,
      'configuredMaximumPlannedMinutes',v_configured_max,
      'expectedElapsedWorkdayMinutes',v_expected_elapsed,'matchingPolicyCount',v_policy_count
    );
  end if;

  select policy.* into v_policy
  from atlas.worker_day_shape_policies policy
  where policy.farm_id=p_farm_id
    and policy.membership_id=p_membership_id
    and policy.active=true
    and policy.effective_from<=p_day
    and (policy.effective_through is null or policy.effective_through>=p_day)
  order by policy.effective_from desc,policy.version desc,policy.created_at desc
  limit 1;

  v_is_working_weekday:=extract(dow from p_day)::smallint=any(v_policy.weekdays);

  if not v_is_working_weekday then
    return jsonb_build_object(
      'contractVersion','worker_day_shape_effective_v1','serviceDate',p_day,
      'state','non_working_day','requiresOwnerDayShape',false,'timezone',v_timezone,
      'matchingPolicyCount',1,'policyId',v_policy.id,'policyKey',v_policy.policy_key,
      'policyName',v_policy.policy_name,'policyVersion',v_policy.version,
      'weekdays',to_jsonb(v_policy.weekdays),'localStart',v_policy.local_start,'localEnd',v_policy.local_end,
      'configuredActiveTargetMinutes',v_active_target,
      'configuredMaximumPlannedMinutes',v_configured_max,
      'expectedElapsedWorkdayMinutes',v_expected_elapsed,
      'effectiveFrom',v_policy.effective_from,'effectiveThrough',v_policy.effective_through,
      'metadata',v_policy.metadata
    );
  end if;

  v_starts_at:=(p_day::timestamp+v_policy.local_start) at time zone v_timezone;
  v_ends_at:=(p_day::timestamp+v_policy.local_end) at time zone v_timezone;

  return jsonb_build_object(
    'contractVersion','worker_day_shape_effective_v1','serviceDate',p_day,
    'state','resolved','requiresOwnerDayShape',false,'timezone',v_timezone,'matchingPolicyCount',1,
    'policyId',v_policy.id,'policyKey',v_policy.policy_key,'policyName',v_policy.policy_name,
    'policyVersion',v_policy.version,'weekdays',to_jsonb(v_policy.weekdays),
    'localStart',v_policy.local_start,'localEnd',v_policy.local_end,
    'startsAt',v_starts_at,'endsAt',v_ends_at,
    'elapsedMinutes',(extract(epoch from (v_ends_at-v_starts_at))/60.0)::integer,
    'configuredActiveTargetMinutes',v_active_target,
    'configuredMaximumPlannedMinutes',v_configured_max,
    'expectedElapsedWorkdayMinutes',v_expected_elapsed,
    'effectiveFrom',v_policy.effective_from,'effectiveThrough',v_policy.effective_through,
    'metadata',v_policy.metadata
  );
end;
$$;