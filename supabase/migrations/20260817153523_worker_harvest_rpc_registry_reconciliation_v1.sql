-- Reconcile authenticated RPC boundaries exposed by the recovered Worker/Harvest migration tranche.
-- Preserve intentional authenticated read/command contracts; remove authenticated/anonymous execution
-- from trigger and internal composition helpers that are not app endpoints.

-- Service-internal Clock trigger helpers.
revoke all on function atlas.capture_clock_placement_event_occurrence_v1() from public;
revoke execute on function atlas.capture_clock_placement_event_occurrence_v1() from anon, authenticated;
grant execute on function atlas.capture_clock_placement_event_occurrence_v1() to service_role;

revoke all on function atlas.capture_clock_placement_occurrence_v1() from public;
revoke execute on function atlas.capture_clock_placement_occurrence_v1() from anon, authenticated;
grant execute on function atlas.capture_clock_placement_occurrence_v1() to service_role;

revoke all on function atlas.log_clock_placement_occurrence_rebase_v1() from public;
revoke execute on function atlas.log_clock_placement_occurrence_rebase_v1() from anon, authenticated;
grant execute on function atlas.log_clock_placement_occurrence_rebase_v1() to service_role;

-- Internal prerequisite/readiness helper: it has no caller authorization boundary of its own.
revoke all on function atlas.task_prerequisites_ready_v1(uuid) from public;
revoke execute on function atlas.task_prerequisites_ready_v1(uuid) from anon, authenticated;
grant execute on function atlas.task_prerequisites_ready_v1(uuid) to service_role;

-- Production trigger/internal helpers.
revoke all on function atlas.prevent_production_reforecast_event_mutation_v1() from public;
revoke execute on function atlas.prevent_production_reforecast_event_mutation_v1() from anon, authenticated;
grant execute on function atlas.prevent_production_reforecast_event_mutation_v1() to service_role;

revoke all on function atlas.reforecast_from_production_lot_event_v1() from public;
revoke execute on function atlas.reforecast_from_production_lot_event_v1() from anon, authenticated;
grant execute on function atlas.reforecast_from_production_lot_event_v1() to service_role;

revoke all on function atlas.prevent_production_operation_actual_mutation_v1() from public;
revoke execute on function atlas.prevent_production_operation_actual_mutation_v1() from anon, authenticated;
grant execute on function atlas.prevent_production_operation_actual_mutation_v1() to service_role;

revoke all on function atlas.ensure_production_clear_path_v1(uuid,uuid) from public;
revoke execute on function atlas.ensure_production_clear_path_v1(uuid,uuid) from anon, authenticated;
grant execute on function atlas.ensure_production_clear_path_v1(uuid,uuid) to service_role;

-- Intentional authenticated composition/read contracts.
revoke all on function atlas.work_occurrence_temporal_contract_v1(uuid,date) from public, anon;
grant execute on function atlas.work_occurrence_temporal_contract_v1(uuid,date) to authenticated, service_role;

revoke all on function atlas.farm_continuity_audit_v1(uuid,date) from public, anon;
grant execute on function atlas.farm_continuity_audit_v1(uuid,date) to authenticated, service_role;

-- Intentional authenticated Owner/Worker and production endpoints.
revoke all on function atlas.owner_worker_next_up_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.owner_worker_next_up_api_v1(uuid,uuid,date) to authenticated, service_role;

revoke all on function atlas.worker_self_next_up_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.worker_self_next_up_api_v1(uuid,uuid,date) to authenticated, service_role;

revoke all on function atlas.owner_worker_weekly_capacity_conflict_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.owner_worker_weekly_capacity_conflict_api_v1(uuid,uuid,date) to authenticated, service_role;

revoke all on function atlas.farm_continuity_audit_v2(uuid,date) from public, anon;
grant execute on function atlas.farm_continuity_audit_v2(uuid,date) to authenticated, service_role;

revoke all on function atlas.production_lot_reforecast_preview_v1(uuid,uuid) from public, anon;
grant execute on function atlas.production_lot_reforecast_preview_v1(uuid,uuid) to authenticated, service_role;

revoke all on function atlas.apply_production_lot_reforecast_v1(uuid,uuid) from public, anon;
grant execute on function atlas.apply_production_lot_reforecast_v1(uuid,uuid) to authenticated, service_role;

revoke all on function atlas.record_production_operation_actual_v1(uuid,integer,numeric,text,date,text,text) from public, anon;
grant execute on function atlas.record_production_operation_actual_v1(uuid,integer,numeric,text,date,text,text) to authenticated, service_role;

revoke all on function atlas.record_production_clear_v1(uuid,date,text,text) from public, anon;
grant execute on function atlas.record_production_clear_v1(uuid,date,text,text) to authenticated, service_role;

revoke all on function atlas.record_production_turnover_v1(uuid,date,text,text) from public, anon;
grant execute on function atlas.record_production_turnover_v1(uuid,date,text,text) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values
('atlas.capture_clock_placement_event_occurrence_v1()','service_internal','verified','active',false,true,true,1,0,jsonb_build_object('purpose','Trigger helper that snapshots occurrence identity on Clock placement events.','boundary','Trigger-only; not an app endpoint.','securityTruth','Authenticated and anonymous execution revoked; service/internal execution retained.'),now(),now()),
('atlas.capture_clock_placement_occurrence_v1()','service_internal','verified','active',false,true,true,1,0,jsonb_build_object('purpose','Trigger helper that snapshots durable occurrence provenance on Clock placements.','boundary','Trigger-only; not an app endpoint.','securityTruth','Authenticated and anonymous execution revoked; service/internal execution retained.'),now(),now()),
('atlas.log_clock_placement_occurrence_rebase_v1()','service_internal','verified','active',false,true,true,1,0,jsonb_build_object('purpose','Trigger helper that appends occurrence-rebase history when a durable Clock placement changes obligation.','boundary','Trigger-only; not an app endpoint.','securityTruth','Authenticated and anonymous execution revoked; service/internal execution retained.'),now(),now()),
('atlas.task_prerequisites_ready_v1(uuid)','service_internal','verified','active',false,true,true,7,0,jsonb_build_object('purpose','Shared prerequisite-readiness helper consumed by Worker selection, execution readiness, and release composition.','boundary','No independent caller authorization contract; app execution is not permitted.','securityTruth','Authenticated and anonymous execution revoked; service/internal execution retained.'),now(),now()),
('atlas.work_occurrence_temporal_contract_v1(uuid, date)','policy_or_composition_helper','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Read the typed lawful-time contract for a durable work occurrence.','boundary','Authenticated read is membership-scoped inside the function; mutation remains service-only through the replacement helper.','temporalTruth','Target/release dates are not promoted into lawful bounds.'),now(),now()),
('atlas.owner_worker_next_up_api_v1(uuid, uuid, date)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Read the governed Next Up decision for a Farm Hand in Owner mode.','boundary','Owner farm membership is enforced inside the function.','clockTruth','Reads Worker execution ordering rather than Principal scheduling.'),now(),now()),
('atlas.worker_self_next_up_api_v1(uuid, uuid, date)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Read the governed Next Up decision for the signed-in Farm Hand.','boundary','Farm Hand self-membership is enforced inside the function.','clockTruth','Worker execution endpoint only.'),now(),now()),
('atlas.owner_worker_weekly_capacity_conflict_api_v1(uuid, uuid, date)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Read the weekly Farm Hand capacity conflict contract in Owner mode.','boundary','Owner farm membership is enforced inside the function.','principalTruth','Only governed capacity exception truth may later escalate to Principal.'),now(),now()),
('atlas.farm_continuity_audit_v1(uuid, date)','policy_or_composition_helper','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Read the base farm continuity audit used by later continuity composition.','boundary','Authenticated reads are farm-membership scoped.','continuityTruth','Audits missing next-state paths without fabricating tasks or physical facts.'),now(),now()),
('atlas.prevent_production_reforecast_event_mutation_v1()','service_internal','verified','active',false,true,true,1,0,jsonb_build_object('purpose','Trigger guard preserving append-only production reforecast evidence.','boundary','Trigger-only; not an app endpoint.','securityTruth','Authenticated and anonymous execution revoked.'),now(),now()),
('atlas.reforecast_from_production_lot_event_v1()','service_internal','verified','active',false,true,true,1,0,jsonb_build_object('purpose','Trigger bridge from production actual events into downstream reforecast evidence.','boundary','Trigger-only; not an app endpoint.','securityTruth','Authenticated and anonymous execution revoked.'),now(),now()),
('atlas.prevent_production_operation_actual_mutation_v1()','service_internal','verified','active',false,true,true,1,0,jsonb_build_object('purpose','Trigger guard preserving append-only production operation actuals.','boundary','Trigger-only; not an app endpoint.','securityTruth','Authenticated and anonymous execution revoked.'),now(),now()),
('atlas.ensure_production_clear_path_v1(uuid, uuid)','service_internal','verified','active',false,true,true,1,0,jsonb_build_object('purpose','Internal helper ensuring a completed production lot retains a clear/turnover path.','boundary','Consumed by production reforecast machinery; not an app endpoint.','securityTruth','Authenticated and anonymous execution revoked.'),now(),now()),
('atlas.production_lot_reforecast_preview_v1(uuid, uuid)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Preview downstream production consequences from recorded actuals before application.','boundary','Authenticated farm membership is enforced inside the function.','truthBoundary','Preview does not itself rewrite production truth.'),now(),now()),
('atlas.apply_production_lot_reforecast_v1(uuid, uuid)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Apply the canonical downstream production reforecast from recorded actual evidence.','boundary','Authenticated farm membership is enforced inside the function.','truthBoundary','Application is grounded in append-only production actual/reforecast evidence.'),now(),now()),
('atlas.record_production_operation_actual_v1(uuid, integer, numeric, text, date, text, text)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Record actual production operation execution evidence.','boundary','Authenticated farm membership is enforced inside the function.','truthBoundary','Records actual work rather than inferred completion.'),now(),now()),
('atlas.record_production_clear_v1(uuid, date, text, text)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Record actual production-lot clearing.','boundary','Authenticated farm membership is enforced inside the function.','continuityTruth','Clear actual closes the living/field path without manufacturing prior harvest truth.'),now(),now()),
('atlas.record_production_turnover_v1(uuid, date, text, text)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Record actual production-lot turnover.','boundary','Authenticated farm membership is enforced inside the function.','continuityTruth','Turnover actual is distinct from planning or clear intent.'),now(),now()),
('atlas.farm_continuity_audit_v2(uuid, date)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('purpose','Read the current farm continuity audit including harvest-end and actual-to-reforecast gaps.','boundary','Authenticated reads are farm-membership scoped.','continuityTruth','Surfaces repair responsibility instead of silently dropping incomplete lifecycle chains.'),now(),now())
on conflict(signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  reviewed_at=excluded.reviewed_at;