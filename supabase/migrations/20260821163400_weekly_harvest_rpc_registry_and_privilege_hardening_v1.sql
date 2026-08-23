-- Close the weekly Harvest RPC surface and register its intended callers.
-- Only the signed-in state readers and v2 row writers remain authenticated endpoints.
-- All shared/core/trigger helpers are service-internal; v1 row writers are retired.

revoke execute on function atlas.weekly_harvest_task_state_for_member_v1(uuid,uuid) from public, anon;
revoke execute on function atlas.owner_operator_weekly_harvest_task_state_v1(uuid,uuid) from public, anon;
revoke execute on function atlas.record_weekly_harvest_row_for_member_v1(uuid,uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
revoke execute on function atlas.owner_operator_record_weekly_harvest_row_v1(uuid,uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
revoke execute on function atlas.record_weekly_harvest_row_for_member_v2(uuid,uuid,uuid,text,integer,text) from public, anon;
revoke execute on function atlas.owner_operator_record_weekly_harvest_row_v2(uuid,uuid,uuid,text,integer,text) from public, anon;

revoke execute on function atlas.ensure_weekly_harvest_card_v1(uuid,date) from public, anon, authenticated;
revoke execute on function atlas.weekly_harvest_candidate_cycles_v1(uuid) from public, anon, authenticated;
revoke execute on function atlas.weekly_harvest_task_state_core_v1(uuid,uuid,text,boolean) from public, anon, authenticated;
revoke execute on function atlas.record_weekly_harvest_row_core_v1(uuid,uuid,uuid,text,text,text,text,text,text,boolean) from public, anon, authenticated;
revoke execute on function atlas.record_weekly_harvest_row_core_v2(uuid,uuid,uuid,text,text,integer,text,boolean) from public, anon, authenticated;
revoke execute on function atlas.suppress_standalone_harvest_carrier_v1() from public, anon, authenticated;

grant execute on function atlas.weekly_harvest_task_state_for_member_v1(uuid,uuid) to authenticated, service_role;
grant execute on function atlas.owner_operator_weekly_harvest_task_state_v1(uuid,uuid) to authenticated, service_role;
grant execute on function atlas.record_weekly_harvest_row_for_member_v2(uuid,uuid,uuid,text,integer,text) to authenticated, service_role;
grant execute on function atlas.owner_operator_record_weekly_harvest_row_v2(uuid,uuid,uuid,text,integer,text) to authenticated, service_role;

grant execute on function atlas.record_weekly_harvest_row_for_member_v1(uuid,uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function atlas.owner_operator_record_weekly_harvest_row_v1(uuid,uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function atlas.ensure_weekly_harvest_card_v1(uuid,date) to service_role;
grant execute on function atlas.weekly_harvest_candidate_cycles_v1(uuid) to service_role;
grant execute on function atlas.weekly_harvest_task_state_core_v1(uuid,uuid,text,boolean) to service_role;
grant execute on function atlas.record_weekly_harvest_row_core_v1(uuid,uuid,uuid,text,text,text,text,text,text,boolean) to service_role;
grant execute on function atlas.record_weekly_harvest_row_core_v2(uuid,uuid,uuid,text,text,integer,text,boolean) to service_role;
grant execute on function atlas.suppress_standalone_harvest_carrier_v1() to service_role;

insert into atlas.authenticated_rpc_registry(
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, registered_at, reviewed_at,
  anonymous_execute_expected
)
values
  ('atlas.weekly_harvest_task_state_for_member_v1(uuid, uuid)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Read the canonical weekly Harvest card for a signed-in farm member.','caller','GET /api/atlas/weekly-harvest','authorizationBoundary','Wrapper resolves current farm role and membership before reading task state.','contractVersion','weekly_harvest_round_v2'),now(),now(),false),
  ('atlas.owner_operator_weekly_harvest_task_state_v1(uuid, uuid)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Read the canonical weekly Harvest card while Owner operator mode is acting as an effective farm membership.','caller','GET /api/atlas/weekly-harvest','authorizationBoundary','Owner operator context resolves the effective membership before reading task state.','contractVersion','weekly_harvest_round_v2'),now(),now(),false),
  ('atlas.record_weekly_harvest_row_for_member_v1(uuid, uuid, uuid, text, text, text, text, text)','app_endpoint','verified','revoked',false,true,true,0,0,jsonb_build_object('purpose','Retired v1 weekly Harvest row writer.','retiredBy','weekly_harvest_round_v2','replacement','atlas.record_weekly_harvest_row_for_member_v2(uuid, uuid, uuid, text, integer, text)'),now(),now(),false),
  ('atlas.owner_operator_record_weekly_harvest_row_v1(uuid, uuid, uuid, text, text, text, text, text)','owner_admin_endpoint','verified','revoked',false,true,true,0,0,jsonb_build_object('purpose','Retired Owner-operator v1 weekly Harvest row writer.','retiredBy','weekly_harvest_round_v2','replacement','atlas.owner_operator_record_weekly_harvest_row_v2(uuid, uuid, uuid, text, integer, text)'),now(),now(),false),
  ('atlas.record_weekly_harvest_row_for_member_v2(uuid, uuid, uuid, text, integer, text)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Record one crop/bed result on the canonical weekly Harvest card.','caller','POST /api/atlas/weekly-harvest','authorizationBoundary','Wrapper resolves current farm membership; core verifies the assigned worker or farm management.','resultGrammar','positive half-bucket amount, not_ready, deadheaded, crop_exhausted'),now(),now(),false),
  ('atlas.owner_operator_record_weekly_harvest_row_v2(uuid, uuid, uuid, text, integer, text)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Record one crop/bed weekly Harvest result in Owner operator mode.','caller','POST /api/atlas/weekly-harvest','authorizationBoundary','Owner operator context resolves the effective membership before the core writer.','resultGrammar','positive half-bucket amount, not_ready, deadheaded, crop_exhausted'),now(),now(),false),
  ('atlas.ensure_weekly_harvest_card_v1(uuid, date)','service_internal','verified','active',false,true,true,3,0,jsonb_build_object('purpose','Materialize or normalize the one weekly Harvest carrier.','directSignedInEndpoint',false,'contractVersion','weekly_harvest_round_v2'),now(),now(),false),
  ('atlas.weekly_harvest_candidate_cycles_v1(uuid)','service_internal','verified','active',false,true,true,3,0,jsonb_build_object('purpose','Resolve crop-cycle rows eligible for the weekly Harvest card.','directSignedInEndpoint',false,'contractVersion','weekly_harvest_round_v2'),now(),now(),false),
  ('atlas.weekly_harvest_task_state_core_v1(uuid, uuid, text, boolean)','service_internal','verified','active',false,true,true,2,0,jsonb_build_object('purpose','Shared authorized weekly Harvest state reader behind member and Owner-operator wrappers.','directSignedInEndpoint',false,'contractVersion','weekly_harvest_round_v2'),now(),now(),false),
  ('atlas.record_weekly_harvest_row_core_v1(uuid, uuid, uuid, text, text, text, text, text, text, boolean)','service_internal','verified','active',false,true,true,2,0,jsonb_build_object('purpose','Retained v1 internal writer for historical compatibility only.','directSignedInEndpoint',false,'publicWrappersRevoked',true),now(),now(),false),
  ('atlas.record_weekly_harvest_row_core_v2(uuid, uuid, uuid, text, text, integer, text, boolean)','service_internal','verified','active',false,true,true,2,0,jsonb_build_object('purpose','Shared current weekly Harvest row writer behind authorized wrappers.','directSignedInEndpoint',false,'contractVersion','weekly_harvest_round_v2'),now(),now(),false),
  ('atlas.suppress_standalone_harvest_carrier_v1()','service_internal','verified','active',false,true,true,1,0,jsonb_build_object('purpose','Trigger helper preventing alternate worker-facing Harvest carriers.','directSignedInEndpoint',false,'contractVersion','weekly_harvest_round_v2'),now(),now(),false)
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
  anonymous_execute_expected=excluded.anonymous_execute_expected,
  reviewed_at=now();

-- A privilege-hardening migration is not complete until the live catalog and
-- governed registry agree. Fail fresh replays immediately rather than allowing
-- a new authenticated RPC surface to drift silently.
do $verification$
declare
  v_drift_count integer;
begin
  select count(*) into v_drift_count
  from atlas.authenticated_rpc_registry_drift_v1();

  if v_drift_count <> 0 then
    raise exception 'Weekly Harvest RPC registry reconciliation left % drift rows.', v_drift_count;
  end if;
end
$verification$;
