import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationName = "20260731211500_atlas_authenticated_rpc_registry_v1.sql";
const migrationPath = new URL(`../supabase/migrations/${migrationName}`, import.meta.url);
const migration = readFileSync(migrationPath, "utf8");
const normalized = migration.replace(/\s+/g, " ").trim();
const liveProof = readFileSync(
  new URL("../supabase/tests/atlas_authenticated_rpc_registry_v1.sql", import.meta.url),
  "utf8",
);
const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

function readMigration(name) {
  return readFileSync(new URL(name, migrationsDirectory), "utf8");
}

function normalizedSql(value) {
  return value.replace(/\s+/g, " ").trim();
}

function compactSql(value) {
  return value
    .replace(/\s+/g, "")
    .toLowerCase()
    .replaceAll("timestamptz", "timestampwithtimezone")
    .replaceAll("int4", "integer")
    .replaceAll("int8", "bigint")
    .replaceAll("bool", "boolean")
    .replaceAll("float8", "doubleprecision")
    .replaceAll("varchar", "charactervarying");
}

function authenticatedGrantedSignatures(sql) {
  const flat = normalizedSql(sql);
  const signatures = [];
  const pattern = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([^;]+?)\s+TO\s+authenticated\b/gi;
  for (const match of flat.matchAll(pattern)) signatures.push(match[1].replace(/\s+/g, " ").trim());
  return signatures;
}

test("registry freezes the signed-in Atlas RPC surface", () => {
  assert.match(normalized, /authenticated_count <> 198/i);
  assert.match(normalized, /anonymous_count <> 0/i);
  assert.match(normalized, /pending_internal_count <> 23/i);
  assert.match(normalized, /CREATE TABLE atlas\.authenticated_rpc_registry/i);
  assert.match(normalized, /oidvectortypes\(p\.proargtypes\)/i);
  assert.match(normalized, /authenticated_execute_expected BOOLEAN NOT NULL/i);
});

test("registry records RPC classification, confidence, and review state", () => {
  for (const classification of ["app_endpoint", "owner_admin_endpoint", "policy_or_composition_helper", "service_internal"]) {
    assert.ok(migration.includes(`'${classification}'`));
  }
  for (const confidence of ["verified", "provisional"]) assert.ok(migration.includes(`'${confidence}'`));
  for (const status of ["active", "pending_revoke", "revoked"]) assert.ok(migration.includes(`'${status}'`));
});

test("registry and drift inspection remain service-only", () => {
  assert.match(normalized, /REVOKE ALL ON TABLE atlas\.authenticated_rpc_registry FROM PUBLIC, anon, authenticated/i);
  assert.match(normalized, /GRANT SELECT ON TABLE atlas\.authenticated_rpc_registry TO service_role/i);
  assert.match(normalized, /REVOKE ALL ON FUNCTION atlas\.authenticated_rpc_registry_drift_v1\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(normalized, /GRANT EXECUTE ON FUNCTION atlas\.authenticated_rpc_registry_drift_v1\(\) TO service_role/i);
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
  ]) assert.ok(migration.includes(`'${issue}'`));
});

test("every later authenticated EXECUTE grant has an ordered registry reconciliation", () => {
  const laterMigrations = readdirSync(migrationsDirectory, { encoding: "utf8" })
    .filter((name) => name.endsWith(".sql") && name > migrationName)
    .sort();

  for (let index = 0; index < laterMigrations.length; index += 1) {
    const name = laterMigrations[index];
    const sql = readMigration(name);
    const signatures = authenticatedGrantedSignatures(sql);

    assert.doesNotMatch(
      sql,
      /GRANT\s+EXECUTE\s+ON\s+ALL\s+FUNCTIONS[\s\S]{0,200}\bauthenticated\b/i,
      `${name} must not broadly grant authenticated function execution`,
    );

    if (!signatures.length || /atlas\.authenticated_rpc_registry/i.test(sql)) continue;

    const laterRegistrySql = laterMigrations
      .slice(index + 1)
      .filter((candidate) => /rpc_registry/i.test(candidate))
      .map((candidate) => ({
        name: candidate,
        sql: normalizedSql(readMigration(candidate)),
        compactSql: compactSql(readMigration(candidate)),
      }));

    for (const signature of signatures) {
      const signatureLoose = signature.replace(/\s*,\s*/g, ", ");
      const compactSignature = compactSql(signature);
      const registry = laterRegistrySql.find((candidate) =>
        candidate.sql.includes(signature)
        || candidate.sql.includes(signatureLoose)
        || candidate.compactSql.includes(compactSignature),
      );
      assert.ok(
        registry,
        `${name} grants authenticated EXECUTE on ${signature} without a later RPC registry reconciliation`,
      );
      assert.ok(name < registry.name, `${name} must precede ${registry.name}`);
    }
  }
});

test("canonical worker-day RPCs are explicitly registered", () => {
  const registry = readMigration("20260809203200_owner_worker_day_plan_rpc_registry_v1.sql");
  assert.ok(registry.includes("atlas.owner_worker_day_plan_api_v1(uuid, uuid, date)"));
  assert.ok(registry.includes("atlas.owner_build_worker_day_schedule_api_v2(uuid, uuid, date, jsonb)"));
  assert.match(registry, /owner_admin_endpoint/);
  assert.match(registry, /automatic_work/);
});

test("important historical public RPC boundaries remain represented by their registry migrations", () => {
  const presented = readMigration("20260802133000_atlas_presented_work_rpc_registry_v1.sql");
  const sky = readMigration("20260808231809_atlas_sky_rpc_registry_v1.sql");
  const skyRuntime = readMigration("20260808233332_atlas_sky_runtime_security_registry_v1.sql");
  const projectMoves = readMigration("20260809183100_project_move_context_rpc_registry_v1.sql");

  for (const signature of [
    "atlas.member_day_load_v1(uuid, uuid, date)",
    "atlas.presented_work_v1(uuid, uuid, date)",
    "atlas.journal_day_for_membership_v1(uuid, uuid, date)",
    "atlas.owner_tomorrow_preflight_v1(uuid, date)",
  ]) assert.ok(presented.includes(signature));

  assert.ok(sky.includes("atlas.sky_state_at_v1(uuid,timestamp with time zone)"));
  assert.ok(skyRuntime.includes("atlas.task_sky_presentation_gate_v1(uuid, date)"));
  assert.ok(projectMoves.includes("atlas.task_move_context_batch_v1(uuid[])"));
});

test("live registry proof is rollback-only and fail-closed", () => {
  assert.match(liveProof, /^BEGIN;/m);
  assert.match(liveProof, /authenticated_rpc_registry_drift_v1\(\)/);
  assert.match(liveProof, /RAISE EXCEPTION 'Atlas authenticated RPC registry drift/);
  assert.match(liveProof, /ROLLBACK;\s*$/);
  assert.doesNotMatch(liveProof, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});
