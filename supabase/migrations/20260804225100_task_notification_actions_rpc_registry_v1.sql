begin;

with desired(signature, classification, call_site, authorization_rule) as (
  values
    (
      'atlas.handle_task_notification_action_v1(uuid, text, integer)',
      'app_endpoint',
      'installed Atlas service worker notification action through /api/atlas/notification-action',
      'signed-in recipient of the notification moment with an active membership; task completion additionally requires one visible quick-completable task'
    )
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
  1,
  3,
  jsonb_build_object(
    'source', 'task_notification_actions_rpc_registry_v1',
    'call_site', desired.call_site,
    'authorization', desired.authorization_rule,
    'reviewed_date', '2026-08-04'
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
    caller_count = excluded.caller_count,
    policy_reference_count = excluded.policy_reference_count,
    evidence = atlas.authenticated_rpc_registry.evidence || excluded.evidence,
    reviewed_at = excluded.reviewed_at;

do $verify$
declare
  v_missing integer;
begin
  select count(*)::integer
  into v_missing
  from (values
    ('atlas.handle_task_notification_action_v1(uuid, text, integer)')
  ) expected(signature)
  left join atlas.authenticated_rpc_registry registry using (signature)
  where registry.signature is null
     or not registry.authenticated_execute_expected;

  if v_missing <> 0 then
    raise exception 'Task notification action RPC registry reconciliation is incomplete: % missing.', v_missing;
  end if;
end;
$verify$;

commit;
