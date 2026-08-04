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
