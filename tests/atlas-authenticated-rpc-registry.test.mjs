import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const baseRegistryName = "20260731211500_atlas_authenticated_rpc_registry_v1.sql";
const baseRegistry = readMigration(baseRegistryName);
const normalized = baseRegistry.replace(/\s+/g, " ").trim();
const liveProof = readFileSync(
  new URL("../supabase/tests/atlas_authenticated_rpc_registry_v1.sql", import.meta.url),
  "utf8",
);

function readMigration(name) {
  return readFileSync(new URL(name, migrationsDirectory), "utf8");
}

const pairedRegistry = new Map([
  ["20260804070500_thursday_morning_execution_checklist_v1.sql", "20260804070700_thursday_morning_execution_checklist_rpc_registry_v1.sql"],
  ["20260804074000_thursday_morning_checklist_clusters_v2.sql", "20260804075500_thursday_morning_clusters_rpc_registry_v2.sql"],
  ["20260804225015_task_notification_actions_v1.sql", "20260804225100_task_notification_actions_rpc_registry_v1.sql"],
  ["20260807134500_grey_couch_decision_selector_v1.sql", "20260807134600_grey_couch_decision_selector_rpc_registry_v1.sql"],
  ["20260807162500_contractor_service_visit_status_v1.sql", "20260807162600_contractor_service_visit_status_rpc_registry_v1.sql"],
  ["20260808023000_owner_week_projection_v1.sql", "20260808023100_owner_week_projection_rpc_registry_v1.sql"],
  ["20260808231140_atlas_sky_ledger_and_operation_rules_v1.sql", "20260808231809_atlas_sky_rpc_registry_v1.sql"],
  ["20260808231244_atlas_sky_ledger_ingest_boundary_v1.sql", "20260808231809_atlas_sky_rpc_registry_v1.sql"],
  ["20260808233130_atlas_sky_fitness_runtime_v2.sql", "20260808233332_atlas_sky_runtime_security_registry_v1.sql"],
  ["20260809011103_atlas_sky_deferrability_and_iris_window_v1.sql", "20260809012855_atlas_sky_deferral_rpc_registry_v1.sql"],
  ["20260809183000_real_project_hierarchy_and_shared_moves.sql", "20260809183100_project_move_context_rpc_registry_v1.sql"],
  ["20260809203000_owner_worker_day_plan_kernel_v1.sql", "20260809203200_owner_worker_day_plan_rpc_registry_v1.sql"],
  ["20260809203100_owner_worker_day_schedule_commit_v2.sql", "20260809203200_owner_worker_day_plan_rpc_registry_v1.sql"],
  ["20260810171500_add_buyer_contact_event_pipeline.sql", "20260810171600_buyer_outreach_rpc_registry_v1.sql"],
  ["20260811154000_atlas_day_choreography_foundation_v1.sql", "20260811162500_atlas_day_choreography_rpc_registry_v1.sql"],
  ["20260811160000_atlas_day_choreography_plan_overlay_v1.sql", "20260811162500_atlas_day_choreography_rpc_registry_v1.sql"],
  ["20260811162000_atlas_day_cue_mutations_v1.sql", "20260811162500_atlas_day_choreography_rpc_registry_v1.sql"],
  ["20260811180500_atlas_day_cue_observation_result_contract_v1.sql", "20260811193000_atlas_day_choreography_acceptance_rpc_registry_v1.sql"],
  ["20260811183000_atlas_departure_requirement_cues_v1.sql", "20260811193000_atlas_day_choreography_acceptance_rpc_registry_v1.sql"],
  ["20260811185000_atlas_event_day_briefing_v1.sql", "20260811193000_atlas_day_choreography_acceptance_rpc_registry_v1.sql"],
  ["20260811190000_atlas_owner_cue_edit_preserves_result_contract_v1.sql", "20260811193000_atlas_day_choreography_acceptance_rpc_registry_v1.sql"],
  ["20260812024500_crop_protection_deer_layer_v1.sql", "20260812024550_crop_protection_rpc_registry_v1.sql"],
]);

for (const name of [
  "20260802124000_atlas_presented_work_contract_v1.sql",
  "20260802125000_atlas_presented_work_reader_cutover_v1.sql",
  "20260802130000_atlas_work_reservoir_backlog_reconciliation_v1.sql",
  "20260802131000_atlas_owner_tomorrow_preflight_v1.sql",
]) {
  pairedRegistry.set(name, "20260802133000_atlas_presented_work_rpc_registry_v1.sql");
}

test("registry freezes the signed-in Atlas RPC surface and stays service-only", () => {
  assert.match(normalized, /authenticated_count <> 198/i);
  assert.match(normalized, /anonymous_count <> 0/i);
  assert.match(normalized, /pending_internal_count <> 23/i);
  assert.match(normalized, /CREATE TABLE atlas\.authenticated_rpc_registry/i);
  assert.match(normalized, /authenticated_execute_expected BOOLEAN NOT NULL/i);
  assert.match(normalized, /REVOKE ALL ON TABLE atlas\.authenticated_rpc_registry FROM PUBLIC, anon, authenticated/i);
  assert.match(normalized, /GRANT SELECT ON TABLE atlas\.authenticated_rpc_registry TO service_role/i);
  assert.match(normalized, /SET search_path = pg_catalog, atlas/i);

  for (const classification of ["app_endpoint", "owner_admin_endpoint", "policy_or_composition_helper", "service_internal"]) {
    assert.ok(baseRegistry.includes(`'${classification}'`));
  }
  for (const issue of [
    "unregistered_authenticated",
    "missing_expected_authenticated",
    "unexpected_authenticated",
    "security_mode_mismatch",
    "service_execute_mismatch",
    "anonymous_execute",
  ]) {
    assert.ok(baseRegistry.includes(`'${issue}'`));
  }
});

test("every later authenticated EXECUTE change has an ordered registry reconciliation", () => {
  const laterMigrations = readdirSync(migrationsDirectory, { encoding: "utf8" })
    .filter((name) => name.endsWith(".sql") && name > baseRegistryName)
    .sort();

  for (const name of laterMigrations) {
    const sql = readMigration(name);
    const changesAuthenticatedExecute = /\b(?:GRANT|REVOKE)\s+EXECUTE\b[\s\S]{0,400}\b(?:TO|FROM)\s+authenticated\b/i.test(sql);

    if (changesAuthenticatedExecute && !/atlas\.authenticated_rpc_registry/i.test(sql)) {
      const registryName = pairedRegistry.get(name) ?? null;
      assert.ok(registryName, `${name} changes authenticated EXECUTE without updating the registry`);
      assert.ok(name < registryName, `${name} must be followed by its ordered RPC registry reconciliation`);
      assert.match(readMigration(registryName), /atlas\.authenticated_rpc_registry/i);
    }

    assert.doesNotMatch(
      sql,
      /GRANT\s+EXECUTE\s+ON\s+ALL\s+FUNCTIONS[\s\S]{0,200}\bauthenticated\b/i,
      `${name} must not broadly grant authenticated function execution`,
    );
  }
});

test("critical app endpoints remain explicitly represented by registry reconciliations", () => {
  const presented = readMigration("20260802133000_atlas_presented_work_rpc_registry_v1.sql");
  const contractor = readMigration("20260807162600_contractor_service_visit_status_rpc_registry_v1.sql");
  const ownerDay = readMigration("20260809203200_owner_worker_day_plan_rpc_registry_v1.sql");
  const buyer = readMigration("20260810171600_buyer_outreach_rpc_registry_v1.sql");
  const choreography = readMigration("20260811162500_atlas_day_choreography_rpc_registry_v1.sql");
  const cropProtection = readMigration("20260812024550_crop_protection_rpc_registry_v1.sql");

  assert.ok(presented.includes("atlas.presented_work_v1(uuid, uuid, date)"));
  assert.ok(contractor.includes("atlas.record_contractor_service_visit_v1(uuid,date,uuid)"));
  assert.ok(ownerDay.includes("atlas.owner_worker_day_plan_api_v1(uuid, uuid, date)"));
  assert.ok(buyer.includes("atlas.record_buyer_outreach_result_v1(uuid, text, text, text, text, text, integer, numeric, date, uuid)"));
  assert.ok(choreography.includes("atlas.worker_day_choreography_api_v1(uuid, uuid, date)"));
  assert.ok(cropProtection.includes("atlas.owner_configure_crop_protection_policy_v1(uuid,text,text[],integer)"));
  assert.match(cropProtection, /owner_admin_endpoint/);
});

test("live registry proof is rollback-only and fail-closed", () => {
  assert.match(liveProof, /^BEGIN;/m);
  assert.match(liveProof, /authenticated_rpc_registry_drift_v1\(\)/);
  assert.match(liveProof, /RAISE EXCEPTION 'Atlas authenticated RPC registry drift/);
  assert.match(liveProof, /pending_internal_count <> 17/);
  assert.match(liveProof, /revoked_count <> 6/);
  assert.match(liveProof, /ROLLBACK;\s*$/);
  assert.doesNotMatch(liveProof, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});
