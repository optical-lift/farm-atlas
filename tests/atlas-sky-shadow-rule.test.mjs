import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260808235134_atlas_sky_shadow_rule_simulator_v1.sql", import.meta.url),
  "utf8",
);

test("shadow sky-rule analysis cannot change task presentation", () => {
  assert.match(migration, /shadow_sky_rule_impact_v1/);
  assert.match(migration, /'simulationOnly',true/);
  assert.match(migration, /'doesNotAffectPresentation',true/);
  assert.doesNotMatch(migration, /update\s+atlas\.tasks/i);
  assert.doesNotMatch(migration, /insert\s+into\s+atlas\.sky_operation_rules/i);
  assert.doesNotMatch(migration, /update\s+atlas\.sky_operation_rules/i);
});

test("shadow analysis exposes window cadence and operational guardrails", () => {
  for (const marker of [
    "knownCoveragePct",
    "favoredCoveragePct",
    "longestUnfavoredHours",
    "windowableFloatingUndated",
    "datedTasksProtectedByGuardrail",
    "hardDateTasksProtectedByGuardrail",
    "processContinuationTasks",
    "wouldWithholdNow",
  ]) {
    assert.ok(migration.includes(`'${marker}'`), marker);
  }
});

test("shadow analysis is management-only and registered", () => {
  assert.match(migration, /is_farm_manager_or_owner/);
  assert.match(migration, /authenticated_rpc_registry/);
  assert.match(migration, /owner_admin_endpoint/);
});
