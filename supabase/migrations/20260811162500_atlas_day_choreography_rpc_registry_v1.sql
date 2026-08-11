-- Day choreography authenticated RPC registry reconciliation v1
-- Locks the new Day delivery boundary to explicit authenticated/service access.

revoke all on function atlas.worker_day_choreography_api_v1(uuid,uuid,date) from public, anon;
revoke all on function atlas.worker_day_placed_task_cards_v1(uuid,uuid,date) from public, anon;
revoke all on function atlas.owner_apply_worker_day_edits_api_v1(uuid,uuid,jsonb) from public, anon;
revoke all on function atlas.owner_worker_day_plan_choreographed_api_v1(uuid,uuid,date) from public, anon;
revoke all on function atlas.owner_upsert_worker_day_cue_api_v1(uuid,uuid,jsonb) from public, anon;
revoke all on function atlas.owner_delete_worker_day_cue_api_v1(uuid,uuid,uuid) from public, anon;
revoke all on function atlas.worker_resolve_day_cue_api_v1(uuid,jsonb) from public, anon;

grant execute on function atlas.worker_day_choreography_api_v1(uuid,uuid,date) to authenticated, service_role;
grant execute on function atlas.worker_day_placed_task_cards_v1(uuid,uuid,date) to authenticated, service_role;
grant execute on function atlas.owner_apply_worker_day_edits_api_v1(uuid,uuid,jsonb) to authenticated, service_role;
grant execute on function atlas.owner_worker_day_plan_choreographed_api_v1(uuid,uuid,date) to authenticated, service_role;
grant execute on function atlas.owner_upsert_worker_day_cue_api_v1(uuid,uuid,jsonb) to authenticated, service_role;
grant execute on function atlas.owner_delete_worker_day_cue_api_v1(uuid,uuid,uuid) to authenticated, service_role;
grant execute on function atlas.worker_resolve_day_cue_api_v1(uuid,jsonb) to authenticated, service_role;

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
    'purpose','Read worker Day placement overrides and non-task cues',
    'boundary','worker self or farm Owner; target membership must be active',
    'taskTruth','placement and cue delivery remain separate from canonical task truth'
  ),now()
),
(
  'atlas.worker_day_placed_task_cards_v1(uuid, uuid, date)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Read canonical task cards explicitly placed onto one worker Day',
    'boundary','worker self or farm Owner; target membership must be active',
    'taskTruth','does not mutate canonical due dates'
  ),now()
),
(
  'atlas.owner_apply_worker_day_edits_api_v1(uuid, uuid, jsonb)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Commit Owner Day placement edits without rewriting task truth',
    'edits','place, rewindow, reschedule, reorder, return_to_atlas',
    'history','writes append-only placement events'
  ),now()
),
(
  'atlas.owner_worker_day_plan_choreographed_api_v1(uuid, uuid, date)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Read the canonical Owner worker-day plan with explicit placement overlay',
    'boundary','farm Owner only with active Farm Hand target',
    'capacity','preserves the existing paid-day engine while placement governs presentation'
  ),now()
),
(
  'atlas.owner_upsert_worker_day_cue_api_v1(uuid, uuid, jsonb)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Create or revise non-task worker Day cues',
    'boundary','farm Owner only with active Farm Hand target',
    'cueKinds','briefing, requirement, observation, somatic, result'
  ),now()
),
(
  'atlas.owner_delete_worker_day_cue_api_v1(uuid, uuid, uuid)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Delete an Owner-authored Day cue before delivery',
    'boundary','farm Owner only for the selected worker and farm'
  ),now()
),
(
  'atlas.worker_resolve_day_cue_api_v1(uuid, jsonb)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Record the response to one delivered Day cue',
    'boundary','assigned worker or farm Owner only',
    'resultTruth','cue response is delivery evidence and does not edit task instructions'
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
