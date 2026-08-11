import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260811154000_atlas_day_choreography_foundation_v1.sql");
const workerPlan = read("lib/atlas/worker-day-plan-server.ts");
const gate = read("components/atlas/owner-day-plan-gate.tsx");
const editRoute = read("app/api/atlas/owner-day-edit/route.ts");
const universalCards = read("app/api/atlas/universal-task-cards/route.ts");
const workOrder = read("lib/atlas/work-order.ts");

test("Day choreography separates task truth, placement history, and non-task cues", () => {
  assert.match(migration, /create table if not exists atlas\.worker_day_task_placements/);
  assert.match(migration, /create table if not exists atlas\.worker_day_task_placement_events/);
  assert.match(migration, /create table if not exists atlas\.worker_day_cues/);
  assert.match(migration, /owner_returned_to_atlas/);
  assert.match(migration, /'placementOverrides'/);
  assert.match(migration, /worker_day_placed_task_cards_v1/);
  assert.doesNotMatch(migration, /update\s+atlas\.tasks\b/i);
});

test("Owner Day planning can resolve one Farm Hand without requiring operator impersonation", () => {
  assert.match(workerPlan, /resolveOwnerWorkerDayPlanningTarget/);
  assert.match(workerPlan, /source: "owner_direct"/);
  assert.match(workerPlan, /\.eq\("role", "farm_hand"\)/);
  assert.match(workerPlan, /workers\.length !== 1/);
  assert.doesNotMatch(workerPlan, /if \(!operatorContext\?\.isOperating\) return/);
});

test("Owner Day gate is an edit doorway even when there are no add-work suggestions", () => {
  assert.match(gate, />\s*Edit today\s*</);
  assert.match(gate, /Editing \{operatorLabel\}&apos;s day/);
  assert.doesNotMatch(gate, /hasPlanningWork/);
});

test("Owner replanning has a dedicated mutation contract including Return to Atlas", () => {
  assert.match(editRoute, /owner-day-edit-v1/);
  assert.match(editRoute, /return_to_atlas/);
  assert.match(editRoute, /rewindow/);
  assert.match(editRoute, /reschedule/);
  assert.match(editRoute, /reorder/);
  assert.match(editRoute, /owner_apply_worker_day_edits_api_v1/);
});

test("explicit Day placement governs worker feed presentation without overwriting canonical due date", () => {
  assert.match(universalCards, /worker_day_choreography_api_v1/);
  assert.match(universalCards, /worker_day_placed_task_cards_v1/);
  assert.match(universalCards, /placementOverrides/);
  assert.match(universalCards, /canonical_due_date: card\.due_date/);
  assert.match(universalCards, /owner_day_window_override/);
  assert.match(universalCards, /placement\.serviceDate === placementDay/);
});

test("a committed Owner Day window outranks ordinary task-family scheduling defaults", () => {
  const ownerOverride = workOrder.indexOf("const placed = ownerDayAnchor(task)");
  const seedDefault = workOrder.indexOf("if (isSeedSowing(task)) return \"evening\"");
  assert.ok(ownerOverride >= 0);
  assert.ok(seedDefault > ownerOverride);
});
