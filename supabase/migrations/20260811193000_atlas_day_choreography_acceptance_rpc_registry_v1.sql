-- Day choreography acceptance RPC registry reconciliation v1
-- Re-locks the authenticated Day surface after the observation, requirement,
-- event-briefing, and Owner cue-edit acceptance migrations redefine it.

revoke all on function atlas.worker_day_choreography_api_v1(uuid,uuid,date) from public, anon;
revoke all on function atlas.worker_resolve_day_cue_api_v1(uuid,jsonb) from public, anon;
revoke all on function atlas.worker_task_day_cues_api_v1(uuid,date) from public, anon;
revoke all on function atlas.owner_upsert_worker_day_cue_api_v1(uuid,uuid,jsonb) from public, anon;

grant execute on function atlas.worker_day_choreography_api_v1(uuid,uuid,date) to authenticated, service_role;
grant execute on function atlas.worker_resolve_day_cue_api_v1(uuid,jsonb) to authenticated, service_role;
grant execute on function atlas.worker_task_day_cues_api_v1(uuid,date) to authenticated, service_role;
grant execute on function atlas.owner_upsert_worker_day_cue_api_v1(uuid,uuid,jsonb) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry (
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
  reviewed_at
)
values
(
  'atlas.worker_day_choreography_api_v1(uuid, uuid, date)',
  'app_endpoint','verified','active',true,true,true,2,0,
  jsonb_build_object(
    'purpose','Read worker Day placements plus fresh briefing, requirement, observation, somatic, and result cues',
    'boundary','worker self or farm Owner; target membership must be active',
    'recovery','stale refresh/persist/block cues return as present-tense reality questions'
  ),now()
),
(
  'atlas.worker_resolve_day_cue_api_v1(uuid, jsonb)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Resolve delivered Day cues and apply only typed canonical result contracts',
    'boundary','assigned worker for farm-state result contracts; ordinary cue access remains role-scoped',
    'contracts','transplant readiness and departure requirement confirmation'
  ),now()
),
(
  'atlas.worker_task_day_cues_api_v1(uuid, date)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Read before-task and after-task cues for one canonical Task Focus',
    'boundary','assigned worker or farm Owner only',
    'recovery','unanswered task-anchored cues may recover as current reality questions'
  ),now()
),
(
  'atlas.owner_upsert_worker_day_cue_api_v1(uuid, uuid, jsonb)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Create, re-anchor, or revise non-task worker Day cues without erasing generated result contracts',
    'boundary','farm Owner only with active Farm Hand target',
    'preservation','omitted resultContract keeps the existing generated contract intact'
  ),now()
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
