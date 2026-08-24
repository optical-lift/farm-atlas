create or replace function atlas.work_scope_resolve_v1(p_operating_unit_id uuid, p_membership_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select jsonb_build_object(
    'contractVersion','work_scope_v1',
    'organizationId', f.organization_id,
    'organizationName', o.name,
    'operatingUnitId', f.id,
    'operatingUnitType','farm',
    'operatingUnitName', f.name,
    'membershipId', fm.id,
    'userId', fm.user_id,
    'operatingUnitRole', fm.role,
    'organizationMembershipId', om.id,
    'organizationRole', om.role,
    'timezone', coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  )
  from atlas.farms f
  join atlas.organizations o
    on o.id=f.organization_id
   and o.status='active'
  join atlas.farm_memberships fm
    on fm.farm_id=f.id
   and fm.id=p_membership_id
   and fm.active=true
  join atlas.organization_memberships om
    on om.organization_id=f.organization_id
   and om.user_id=fm.user_id
   and om.active=true
  where f.id=p_operating_unit_id
    and f.status='active'
  limit 1;
$$;

revoke all on function atlas.work_scope_resolve_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function atlas.work_scope_resolve_v1(uuid,uuid) to service_role;

create or replace function atlas.worker_day_shape_effective_v1(p_farm_id uuid, p_membership_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
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

  v_scope:=atlas.work_scope_resolve_v1(p_farm_id,p_membership_id);
  if v_scope is null then
    raise exception 'Active worker operating scope required.' using errcode='P0002';
  end if;

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
      'organizationId',v_scope->>'organizationId','operatingUnitId',v_scope->>'operatingUnitId',
      'configuredActiveTargetMinutes',v_active_target,
      'configuredMaximumPlannedMinutes',v_configured_max,
      'expectedElapsedWorkdayMinutes',v_expected_elapsed,'matchingPolicyCount',0
    );
  elsif v_policy_count>1 then
    return jsonb_build_object(
      'contractVersion','worker_day_shape_effective_v1','serviceDate',p_day,
      'state','policy_conflict','requiresOwnerDayShape',true,'timezone',v_timezone,
      'organizationId',v_scope->>'organizationId','operatingUnitId',v_scope->>'operatingUnitId',
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
      'organizationId',v_scope->>'organizationId','operatingUnitId',v_scope->>'operatingUnitId',
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
    'state','resolved','requiresOwnerDayShape',false,'timezone',v_timezone,
    'organizationId',v_scope->>'organizationId','operatingUnitId',v_scope->>'operatingUnitId',
    'matchingPolicyCount',1,
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

insert into atlas.productization_surface_classifications
  (family_key,classification,function_name_pattern,canonical_owner,domain_key,tenant_key,portability_state,authority_bearing,rationale,metadata)
values (
  'work_scope','platform','^work_scope_','platform_scope',null,null,'portable',true,
  'Organization -> operating unit -> membership scope is a reusable Atlas platform boundary. Farms remain one operating-unit implementation rather than the tenant root.',
  jsonb_build_object('tranche',0,'introducedBy','platform_worker_operating_scope_adapter_v1')
)
on conflict (family_key) do update set
  classification=excluded.classification,
  function_name_pattern=excluded.function_name_pattern,
  canonical_owner=excluded.canonical_owner,
  portability_state=excluded.portability_state,
  authority_bearing=excluded.authority_bearing,
  rationale=excluded.rationale,
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
    and p.proname ~ '^(principal_|worker_(day|self)_|farm_clock_|work_scope_|crop_|harvest_|grow_room_|owner_operator_|owner_needs_from_you|truth_acquisition_|requirement_)'
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

insert into atlas.authenticated_rpc_registry (
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,
  service_execute_expected,caller_count,policy_reference_count,evidence,anonymous_execute_expected
)
values (
  'atlas.work_scope_resolve_v1(uuid, uuid)',
  'service_internal','verified','revoked',false,true,true,1,0,
  jsonb_build_object('source','platform_worker_operating_scope_adapter_v1','purpose','Canonical platform scope adapter consumed internally by Worker Day; not a client RPC'),false
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