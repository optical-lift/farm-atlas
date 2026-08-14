import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationName =
  "20260731211500_atlas_authenticated_rpc_registry_v1.sql";
const presentedWorkRegistryMigrationName =
  "20260802133000_atlas_presented_work_rpc_registry_v1.sql";
const thursdayChecklistMigrationName =
  "20260804070500_thursday_morning_execution_checklist_v1.sql";
const thursdayChecklistRegistryMigrationName =
  "20260804070700_thursday_morning_execution_checklist_rpc_registry_v1.sql";
const thursdayClusterMigrationName =
  "20260804074000_thursday_morning_checklist_clusters_v2.sql";
const thursdayClusterRegistryMigrationName =
  "20260804075500_thursday_morning_clusters_rpc_registry_v2.sql";
const notificationActionsMigrationName =
  "20260804225015_task_notification_actions_v1.sql";
const notificationActionsRegistryMigrationName =
  "20260804225100_task_notification_actions_rpc_registry_v1.sql";
const greyCouchDecisionMigrationName =
  "20260807134500_grey_couch_decision_selector_v1.sql";
const greyCouchDecisionRegistryMigrationName =
  "20260807134600_grey_couch_decision_selector_rpc_registry_v1.sql";
const contractorServiceMigrationName =
  "20260807162500_contractor_service_visit_status_v1.sql";
const contractorServiceRegistryMigrationName =
  "20260807162600_contractor_service_visit_status_rpc_registry_v1.sql";
const ownerWeekProjectionMigrationName =
  "20260808023000_owner_week_projection_v1.sql";
const ownerWeekProjectionRegistryMigrationName =
  "20260808023100_owner_week_projection_rpc_registry_v1.sql";
const skyRulesMigrationName =
  "20260808231140_atlas_sky_ledger_and_operation_rules_v1.sql";
const skyIngestMigrationName =
  "20260808231244_atlas_sky_ledger_ingest_boundary_v1.sql";
const skyRulesRegistryMigrationName =
  "20260808231809_atlas_sky_rpc_registry_v1.sql";
const skyRuntimeMigrationName =
  "20260808233130_atlas_sky_fitness_runtime_v2.sql";
const skyRuntimeRegistryMigrationName =
  "20260808233332_atlas_sky_runtime_security_registry_v1.sql";
const skyDeferralMigrationName =
  "20260809011103_atlas_sky_deferrability_and_iris_window_v1.sql";
const skyDeferralRegistryMigrationName =
  "20260809012855_atlas_sky_deferral_rpc_registry_v1.sql";
const projectMovesMigrationName =
  "20260809183000_real_project_hierarchy_and_shared_moves.sql";
const projectMovesRegistryMigrationName =
  "20260809183100_project_move_context_rpc_registry_v1.sql";
const ownerWorkerDayPlanMigrationName =
  "20260809203000_owner_worker_day_plan_kernel_v1.sql";
const ownerWorkerDayScheduleMigrationName =
  "20260809203100_owner_worker_day_schedule_commit_v2.sql";
const ownerWorkerDayRegistryMigrationName =
  "20260809203200_owner_worker_day_plan_rpc_registry_v1.sql";
const buyerOutreachMigrationName =
  "20260810171500_add_buyer_contact_event_pipeline.sql";
const buyerOutreachRegistryMigrationName =
  "20260810171600_buyer_outreach_rpc_registry_v1.sql";
const dayChoreographyFoundationMigrationName =
  "20260811154000_atlas_day_choreography_foundation_v1.sql";
const dayChoreographyOverlayMigrationName =
  "20260811160000_atlas_day_choreography_plan_overlay_v1.sql";
const dayCueMutationsMigrationName =
  "20260811162000_atlas_day_cue_mutations_v1.sql";
const dayChoreographyRegistryMigrationName =
  "20260811162500_atlas_day_choreography_rpc_registry_v1.sql";
const dayAcceptanceRegistryMigrationName =
  "20260811193000_atlas_day_choreography_acceptance_rpc_registry_v1.sql";
const ownerDayReservationCommandMigrationName =
  "20260814133500_owner_day_reservation_commands_v1.sql";
const ownerDayReservationHardeningMigrationName =
  "20260814141500_fixed_routine_projection_hardening_v1.sql";
const ownerDayReservationRegistryMigrationName =
  "20260814141600_owner_day_reservation_rpc_registry_v1.sql";
const dayAcceptanceRpcMigrations = new Set([
  "20260811180500_atlas_day_cue_observation_result_contract_v1.sql",
  "20260811183000_atlas_departure_requirement_cues_v1.sql",
  "20260811185000_atlas_event_day_briefing_v1.sql",
  "20260811190000_atlas_owner_cue_edit_preserves_result_contract_v1.sql",
]);
const migrationPath = new URL(
  `../supabase/migrations/${migrationName}`,
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");
const normalized = migration.replace(/\s+/g, " ").trim();
const liveProof = readFileSync(
  new URL(
    "../supabase/tests/atlas_authenticated_rpc_registry_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

function readMigration(name) {
  return readFileSync(new URL(name, migrationsDirectory), "utf8");
}

test("registry freezes the complete signed-in Atlas RPC surface", () => {
  assert.match(normalized, /authenticated_count <> 198/i);
  assert.match(normalized, /anonymous_count <> 0/i);
  assert.match(normalized, /pending_internal_count <> 23/i);
  assert.match(normalized, /CREATE TABLE atlas\.authenticated_rpc_registry/i);
  assert.match(normalized, /oidvectortypes\(p\.proargtypes\)/i);
  assert.match(normalized, /authenticated_execute_expected BOOLEAN NOT NULL/i);
});

test("registry records the four RPC classes and review confidence", () => {
  for (const classification of [
    "app_endpoint",
    "owner_admin_endpoint",
    "policy_or_composition_helper",
    "service_internal",
  ]) {
    assert.ok(migration.includes(`'${classification}'`));
  }

  for (const confidence of ["verified", "provisional"]) {
    assert.ok(migration.includes(`'${confidence}'`));
  }

  for (const status of ["active", "pending_revoke", "revoked"]) {
    assert.ok(migration.includes(`'${status}'`));
  }
});

test("registry and drift inspection remain service-only", () => {
  assert.match(
    normalized,
    /REVOKE ALL ON TABLE atlas\.authenticated_rpc_registry FROM PUBLIC, anon, authenticated/i,
  );
  assert.match(
    normalized,
    /GRANT SELECT ON TABLE atlas\.authenticated_rpc_registry TO service_role/i,
  );
  assert.match(
    normalized,
    /REVOKE ALL ON FUNCTION atlas\.authenticated_rpc_registry_drift_v1\(\) FROM PUBLIC, anon, authenticated/i,
  );
  assert.match(
    normalized,
    /GRANT EXECUTE ON FUNCTION atlas\.authenticated_rpc_registry_drift_v1\(\) TO service_role/i,
  );
  assert.match(normalized, /SET search_path = pg_catalog, atlas/i);
});

test("drift proof covers new, missing, changed, and anonymous execution", () => {
  for (const issue of [
    "unregistered_authenticated",
    "missing_expected_authenticated",
    "unexpected_authenticated",
    "security_mode_mismatch",
    "service_execute_mismatch",
    "anonymous_execute",
  ]) {
    assert.ok(migration.includes(`'${issue}'`));
  }
});

test("future authenticated EXECUTE changes must update the registry", () => {
  const laterMigrations = readdirSync(migrationsDirectory, { encoding: "utf8" })
    .filter((name) => name.endsWith(".sql") && name > migrationName)
    .sort();
  const batchedPresentedWorkMigrations = new Set([
    "20260802124000_atlas_presented_work_contract_v1.sql",
    "20260802125000_atlas_presented_work_reader_cutover_v1.sql",
    "20260802130000_atlas_work_reservoir_backlog_reconciliation_v1.sql",
    "20260802131000_atlas_owner_tomorrow_preflight_v1.sql",
  ]);
  const presentedWorkRegistry = readMigration(presentedWorkRegistryMigrationName);
  const thursdayChecklistRegistry = readMigration(thursdayChecklistRegistryMigrationName);
  const thursdayClusterRegistry = readMigration(thursdayClusterRegistryMigrationName);
  const notificationActionsRegistry = readMigration(notificationActionsRegistryMigrationName);
  const greyCouchDecisionRegistry = readMigration(greyCouchDecisionRegistryMigrationName);
  const contractorServiceRegistry = readMigration(contractorServiceRegistryMigrationName);
  const ownerWeekProjectionRegistry = readMigration(ownerWeekProjectionRegistryMigrationName);
  const skyRulesRegistry = readMigration(skyRulesRegistryMigrationName);
  const skyRuntimeRegistry = readMigration(skyRuntimeRegistryMigrationName);
  const skyDeferralRegistry = readMigration(skyDeferralRegistryMigrationName);
  const projectMovesRegistry = readMigration(projectMovesRegistryMigrationName);
  const ownerWorkerDayRegistry = readMigration(ownerWorkerDayRegistryMigrationName);
  const buyerOutreachRegistry = readMigration(buyerOutreachRegistryMigrationName);
  const dayChoreographyRegistry = readMigration(dayChoreographyRegistryMigrationName);
  const dayAcceptanceRegistry = readMigration(dayAcceptanceRegistryMigrationName);
  const ownerDayReservationRegistry = readMigration(ownerDayReservationRegistryMigrationName);

  for (const name of laterMigrations) {
    const sql = readMigration(name);
    const changesAuthenticatedExecute =
      /\b(?:GRANT|REVOKE)\s+EXECUTE\b[\s\S]{0,400}\b(?:TO|FROM)\s+authenticated\b/i.test(
        sql,
      );

    if (changesAuthenticatedExecute && !/atlas\.authenticated_rpc_registry/i.test(sql)) {
      const pairedRegistryName = batchedPresentedWorkMigrations.has(name)
        ? presentedWorkRegistryMigrationName
        : name === thursdayChecklistMigrationName
          ? thursdayChecklistRegistryMigrationName
          : name === thursdayClusterMigrationName
            ? thursdayClusterRegistryMigrationName
            : name === notificationActionsMigrationName
              ? notificationActionsRegistryMigrationName
              : name === greyCouchDecisionMigrationName
                ? greyCouchDecisionRegistryMigrationName
                : name === contractorServiceMigrationName
                  ? contractorServiceRegistryMigrationName
                  : name === ownerWeekProjectionMigrationName
                    ? ownerWeekProjectionRegistryMigrationName
                    : name === skyRulesMigrationName || name === skyIngestMigrationName
                      ? skyRulesRegistryMigrationName
                      : name === skyRuntimeMigrationName
                        ? skyRuntimeRegistryMigrationName
                        : name === skyDeferralMigrationName
                          ? skyDeferralRegistryMigrationName
                          : name === projectMovesMigrationName
                            ? projectMovesRegistryMigrationName
                            : name === ownerWorkerDayPlanMigrationName || name === ownerWorkerDayScheduleMigrationName
                              ? ownerWorkerDayRegistryMigrationName
                              : name === buyerOutreachMigrationName
                                ? buyerOutreachRegistryMigrationName
                                : name === dayChoreographyFoundationMigrationName || name === dayChoreographyOverlayMigrationName || name === dayCueMutationsMigrationName
                                  ? dayChoreographyRegistryMigrationName
                                  : dayAcceptanceRpcMigrations.has(name)
                                    ? dayAcceptanceRegistryMigrationName
                                    : name === ownerDayReservationCommandMigrationName || name === ownerDayReservationHardeningMigrationName
                                      ? ownerDayReservationRegistryMigrationName
                                      : null;

      assert.ok(
        pairedRegistryName,
        `${name} changes authenticated EXECUTE without updating the registry`,
      );
      assert.ok(
        name < pairedRegistryName,
        `${name} must be followed by its ordered RPC registry reconciliation`,
      );
    }

    assert.doesNotMatch(
      sql,
      /GRANT\s+EXECUTE\s+ON\s+ALL\s+FUNCTIONS[\s\S]{0,200}\bauthenticated\b/i,
      `${name} must not broadly grant authenticated function execution`,
    );
  }

  for (const signature of [
    "atlas.member_day_load_v1(uuid, uuid, date)",
    "atlas.object_work_context_v2(uuid, text, uuid, date)",
    "atlas.create_object_work_v2(uuid, text, text, text, text, text, text, text, uuid, date, text, text, boolean, uuid[], text[], text)",
    "atlas.presented_work_v1(uuid, uuid, date)",
    "atlas.journal_day_for_membership_v1(uuid, uuid, date)",
    "atlas.journal_day_v1(uuid, date)",
    "atlas.resolve_work_reservoir_decision_v1(uuid, text, date, text)",
    "atlas.owner_tomorrow_preflight_v1(uuid, date)",
  ]) {
    assert.ok(presentedWorkRegistry.includes(signature));
  }

  for (const signature of [
    "atlas.task_execution_checklist_v1(uuid, uuid)",
    "atlas.record_task_execution_check_v1(uuid, text, boolean, text, uuid)",
  ]) {
    assert.ok(thursdayChecklistRegistry.includes(signature));
    assert.ok(thursdayClusterRegistry.includes(signature));
  }

  assert.ok(notificationActionsRegistry.includes(
    "atlas.handle_task_notification_action_v1(uuid, text, integer)",
  ));
  assert.ok(greyCouchDecisionRegistry.includes(
    "atlas.resolve_task_decision_selector_v1(uuid, text, uuid)",
  ));
  assert.ok(contractorServiceRegistry.includes(
    "atlas.record_contractor_service_visit_v1(uuid,date,uuid)",
  ));
  assert.ok(ownerWeekProjectionRegistry.includes(
    "atlas.refresh_owner_week_projection_v1(uuid, uuid, date, integer)",
  ));
  assert.ok(skyRulesRegistry.includes(
    "atlas.sky_state_at_v1(uuid,timestamp with time zone)",
  ));
  assert.ok(skyRulesRegistry.includes(
    "atlas.task_sky_fitness_v1(uuid,timestamp with time zone)",
  ));
  assert.ok(skyRulesRegistry.includes(
    "atlas.ingest_sky_ledger_v1(uuid,timestamp with time zone,timestamp with time zone,text,jsonb,jsonb)",
  ));
  for (const signature of [
    "atlas.sky_state_at_v2(uuid, timestamp with time zone)",
    "atlas.task_sky_fitness_v2(uuid, timestamp with time zone)",
    "atlas.task_sky_presentation_gate_v1(uuid, date)",
    "atlas.sky_ledger_status_v1(uuid)",
  ]) {
    assert.ok(skyRuntimeRegistry.includes(signature));
  }
  assert.ok(skyDeferralRegistry.includes(
    "atlas.task_sky_deferral_policy_v1(uuid, timestamp with time zone)",
  ));
  assert.ok(skyDeferralRegistry.includes(
    "atlas.task_sky_presentation_gate_v1(uuid, date)",
  ));
  assert.ok(projectMovesRegistry.includes(
    "atlas.task_move_context_batch_v1(uuid[])",
  ));
  assert.match(
    projectMovesRegistry,
    /revoke all on function atlas\.project_path_v1\(uuid\) from public,anon,authenticated/i,
  );
  assert.ok(ownerWorkerDayRegistry.includes(
    "atlas.owner_worker_day_plan_api_v1(uuid, uuid, date)",
  ));
  assert.ok(ownerWorkerDayRegistry.includes(
    "atlas.owner_build_worker_day_schedule_api_v2(uuid, uuid, date, jsonb)",
  ));
  assert.match(ownerWorkerDayRegistry, /owner_admin_endpoint/);
  assert.match(ownerWorkerDayRegistry, /automatic_work/);
  assert.ok(buyerOutreachRegistry.includes(
    "atlas.record_buyer_outreach_result_v1(uuid, text, text, text, text, text, integer, numeric, date, uuid)",
  ));
  assert.match(buyerOutreachRegistry, /app_endpoint/);

  for (const signature of [
    "atlas.worker_day_choreography_api_v1(uuid, uuid, date)",
    "atlas.worker_day_placed_task_cards_v1(uuid, uuid, date)",
    "atlas.owner_apply_worker_day_edits_api_v1(uuid, uuid, jsonb)",
    "atlas.owner_worker_day_plan_choreographed_api_v1(uuid, uuid, date)",
    "atlas.owner_upsert_worker_day_cue_api_v1(uuid, uuid, jsonb)",
    "atlas.owner_delete_worker_day_cue_api_v1(uuid, uuid, uuid)",
    "atlas.worker_resolve_day_cue_api_v1(uuid, jsonb)",
  ]) {
    assert.ok(dayChoreographyRegistry.includes(signature));
  }
  assert.match(dayChoreographyRegistry, /owner_admin_endpoint/);
  assert.match(dayChoreographyRegistry, /app_endpoint/);
  assert.match(dayChoreographyRegistry, /revoke all on function atlas\.worker_day_choreography_api_v1\(uuid,uuid,date\) from public, anon/i);

  for (const signature of [
    "atlas.worker_day_choreography_api_v1(uuid, uuid, date)",
    "atlas.worker_resolve_day_cue_api_v1(uuid, jsonb)",
    "atlas.worker_task_day_cues_api_v1(uuid, date)",
    "atlas.owner_upsert_worker_day_cue_api_v1(uuid, uuid, jsonb)",
  ]) {
    assert.ok(dayAcceptanceRegistry.includes(signature));
  }
  assert.match(dayAcceptanceRegistry, /owner_admin_endpoint/);
  assert.match(dayAcceptanceRegistry, /app_endpoint/);

  for (const signature of [
    "atlas.owner_command_day_reservation_api_v1(uuid, uuid, date, jsonb)",
    "atlas.sync_fixed_routine_reservations_for_day_v1(uuid, uuid, date)",
  ]) {
    assert.ok(ownerDayReservationRegistry.includes(signature));
  }
  assert.match(ownerDayReservationRegistry, /owner_admin_endpoint/);
  assert.match(ownerDayReservationRegistry, /app_endpoint/);
});

test("live registry proof is rollback-only and fail-closed", () => {
  assert.match(liveProof, /^BEGIN;/m);
  assert.match(liveProof, /authenticated_rpc_registry_drift_v1\(\)/);
  assert.match(liveProof, /RAISE EXCEPTION 'Atlas authenticated RPC registry drift/);
  assert.match(liveProof, /pending_internal_count <> 17/);
  assert.match(liveProof, /revoked_count <> 6/);
  assert.match(liveProof, /ROLLBACK;\s*$/);
  assert.doesNotMatch(
    liveProof,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
});
