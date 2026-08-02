begin;

-- The Presented Work cutover was applied as a tightly ordered production build.
-- Reconcile every signed-in endpoint introduced or re-granted by that build with
-- the canonical authenticated RPC registry before any later migration may alter
-- the signed-in surface.

with desired(signature, classification, call_site, authorization_rule) as (
  values
    ('atlas.member_day_load_v1(uuid, uuid, date)', 'policy_or_composition_helper', 'Work Card day-load preview and Presented Work', 'self or farm management'),
    ('atlas.object_work_context_v2(uuid, text, uuid, date)', 'app_endpoint', 'object Work Card composer', 'active same-farm member'),
    ('atlas.create_object_work_v2(uuid, text, text, text, text, text, text, text, uuid, date, text, text, boolean, uuid[], text[], text)', 'owner_admin_endpoint', 'object Work Card composer', 'owner or manager'),
    ('atlas.presented_work_v1(uuid, uuid, date)', 'app_endpoint', 'Presented Work and Tomorrow Preflight', 'self or farm management'),
    ('atlas.journal_day_for_membership_v1(uuid, uuid, date)', 'policy_or_composition_helper', 'Living Day membership reader', 'self or farm management'),
    ('atlas.journal_day_v1(uuid, date)', 'policy_or_composition_helper', 'canonical Journal day reader', 'active same-farm member'),
    ('atlas.resolve_work_reservoir_decision_v1(uuid, text, date, text)', 'owner_admin_endpoint', 'Tomorrow Preflight decision action', 'owner or manager'),
    ('atlas.owner_tomorrow_preflight_v1(uuid, date)', 'owner_admin_endpoint', 'Tomorrow Preflight', 'owner or manager')
), actual as (
  select
    format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature,
    p.prosecdef as security_definer,
    has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
    has_function_privilege('service_role', p.oid, 'execute') as service_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas'
    and p.prokind = 'f'
)
insert into atlas.authenticated_rpc_registry(
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
)
select
  desired.signature,
  desired.classification,
  'verified',
  'active',
  true,
  actual.security_definer,
  actual.service_execute,
  0,
  0,
  jsonb_build_object(
    'source', 'presented_work_rpc_registry_v1',
    'call_site', desired.call_site,
    'authorization', desired.authorization_rule,
    'reviewed_date', '2026-08-02'
  ),
  now(),
  now()
from desired
join actual using (signature)
where actual.authenticated_execute
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    evidence = atlas.authenticated_rpc_registry.evidence || excluded.evidence,
    reviewed_at = excluded.reviewed_at;

do $verify$
declare
  v_missing integer;
begin
  select count(*)::integer
  into v_missing
  from (values
    ('atlas.member_day_load_v1(uuid, uuid, date)'),
    ('atlas.object_work_context_v2(uuid, text, uuid, date)'),
    ('atlas.create_object_work_v2(uuid, text, text, text, text, text, text, text, uuid, date, text, text, boolean, uuid[], text[], text)'),
    ('atlas.presented_work_v1(uuid, uuid, date)'),
    ('atlas.journal_day_for_membership_v1(uuid, uuid, date)'),
    ('atlas.journal_day_v1(uuid, date)'),
    ('atlas.resolve_work_reservoir_decision_v1(uuid, text, date, text)'),
    ('atlas.owner_tomorrow_preflight_v1(uuid, date)')
  ) expected(signature)
  left join atlas.authenticated_rpc_registry registry using (signature)
  where registry.signature is null
     or not registry.authenticated_execute_expected;

  if v_missing <> 0 then
    raise exception 'Presented Work authenticated RPC registry reconciliation is incomplete: % missing.', v_missing;
  end if;
end;
$verify$;

commit;
