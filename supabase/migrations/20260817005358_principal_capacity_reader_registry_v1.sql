begin;

create or replace function atlas.principal_capacity_policies_self_api_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_principal_id uuid;
  v_policies jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  v_principal_id := atlas.current_principal_id_v1();
  if v_principal_id is null then
    raise exception 'Active Principal context required.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'stableKey', p.stable_key,
    'name', p.name,
    'weekdays', to_jsonb(p.weekdays),
    'localStart', to_char(p.local_start, 'HH24:MI'),
    'localEnd', to_char(p.local_end, 'HH24:MI'),
    'defaultDiscretionaryMinutes', p.default_discretionary_minutes,
    'maximumPlannedMinutes', p.maximum_planned_minutes,
    'effectiveFrom', p.effective_from,
    'effectiveThrough', p.effective_through,
    'active', p.active,
    'metadata', p.metadata,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  ) order by p.effective_from desc, p.created_at desc), '[]'::jsonb)
  into v_policies
  from atlas.principal_capacity_policies p
  where p.principal_id = v_principal_id
    and p.active;

  return jsonb_build_object(
    'contractVersion', 'principal_capacity_policies_self_v1',
    'principalId', v_principal_id,
    'policies', v_policies,
    'capacityToday', atlas.principal_capacity_day_state_v1(v_principal_id, current_date)
  );
end;
$$;

revoke all on function atlas.principal_capacity_policies_self_api_v1() from public, anon;
grant execute on function atlas.principal_capacity_policies_self_api_v1() to authenticated, service_role;

revoke execute on function atlas.current_principal_id_v1() from public, anon, authenticated;
grant execute on function atlas.current_principal_id_v1() to service_role;

insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, reviewed_at
)
values
(
  'atlas.principal_capacity_policies_self_api_v1()',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object('purpose','Return the authenticated Principal capacity-policy inventory and resolved capacity today','boundary','auth.uid resolves through internal current_principal_id_v1; no cross-Principal identifier input'),now()
),
(
  'atlas.current_principal_id_v1()',
  'policy_or_composition_helper','verified','active',false,true,true,0,0,
  jsonb_build_object('purpose','Resolve auth.uid to the active Principal id for trusted Principal composition functions','boundary','internal composition helper; direct authenticated EXECUTE intentionally revoked'),now()
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

commit;
