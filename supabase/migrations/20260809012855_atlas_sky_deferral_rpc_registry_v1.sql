create or replace function atlas.task_sky_deferral_policy_v1(
  p_task_id uuid,
  p_at timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
  select atlas.task_sky_deferral_policy_v2(p_task_id,p_at);
$$;

revoke all on function atlas.task_sky_deferral_policy_v1(uuid,timestamptz) from public,anon;
grant execute on function atlas.task_sky_deferral_policy_v1(uuid,timestamptz) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values
(
  'atlas.task_sky_deferral_policy_v1(uuid, timestamp with time zone)',
  'policy_or_composition_helper','verified','active',true,true,true,0,1,
  jsonb_build_object(
    'purpose','Compatibility read of the current task sky-deferral policy; delegates to task_sky_deferral_policy_v2 so signed-in callers cannot observe stale v1 semantics.',
    'runtimeAuthority','task_sky_deferral_policy_v2',
    'safetyBoundary','Farm urgency, live dates, crop timing, dependencies, workflow lanes, and cumulative horizon expiry can all revoke sky withholding.'
  ),now(),now()
),(
  'atlas.task_sky_presentation_gate_v1(uuid, date)',
  'policy_or_composition_helper','verified','active',true,true,true,3,1,
  jsonb_build_object(
    'purpose','Compose operation fitness with first-class task deferrability. A Windowed rule can withhold only while farm truth still permits delay.',
    'deferralAuthority','task_sky_deferral_policy_v2',
    'failOpen',true
  ),now(),now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;
