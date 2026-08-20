import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("supabase/migrations/20260820192123_worker_day_canonical_result_authority_v1.sql", "utf8");
const dayPage = fs.readFileSync("app/day/page.tsx", "utf8");

test("Worker Day result authority is canonical and task-generic", () => {
  assert.match(migration, /worker_task_requires_structured_result_v1/);
  assert.match(migration, /quick_complete_v1_available/);
  assert.match(migration, /structured_result_adapter_required/);
  assert.match(migration, /operation_result_not_authorized/);
  assert.match(migration, /worker_result_authority','worker_state_transition_card_v2'/);
  assert.match(migration, /'quick_complete_allowed',v_result_state='quick_complete_v1_available'/);
  assert.match(migration, /'structured_result_required',v_result_state in \('structured_result_v1_available','structured_result_adapter_required'\)/);

  for (const forbidden of ["Chicken Chore", "Weed MG11", "Mow Corral", "Water Outdoor Planters"]) {
    assert.equal(migration.includes(forbidden), false, `must not hardcode ${forbidden}`);
  }
});

test("Day circle consumes explicit canonical quick-complete metadata before legacy fallback classification", () => {
  const fnStart = dayPage.indexOf("function requiresStructuredResult");
  const fnEnd = dayPage.indexOf("function objectStateBefore", fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart, "requiresStructuredResult function must exist");
  const fn = dayPage.slice(fnStart, fnEnd);

  const allow = fn.indexOf('truthy(meta(task, "quick_complete_allowed"))');
  const deny = fn.indexOf('meta(task, "quick_complete_allowed") === false');
  const routeFallback = fn.indexOf("atlasRouteKeyForTask(task)");
  assert.ok(allow >= 0, "explicit quick-complete allow must be checked");
  assert.ok(deny > allow, "explicit quick-complete deny must be checked after allow");
  assert.ok(routeFallback > deny, "legacy route heuristic must only be a fallback after canonical metadata");
});
