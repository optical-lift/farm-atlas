import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const dockProfile = read("lib/atlas/dock-profile.ts");
const datedCards = read("app/api/atlas/universal-task-cards/route.ts");
const ownerWork = read("lib/atlas-data/owner-my-work.ts");
const containment = read("supabase/migrations/20260823131644_worker_feed_readiness_and_rollover_containment_v1.sql");
const farmRoundWindow = read("supabase/migrations/20260823132438_farm_round_worker_day_position_v1.sql");
const registry = read("supabase/migrations/20260823132603_worker_executable_task_ids_rpc_registry_v1.sql");
const restoredRollover = read("supabase/migrations/20260823143918_restore_worker_rollover_farm_round_singleton_and_chard_mg5_v1.sql");
const repairedRollover = read("supabase/migrations/20260823144407_unfinished_rollover_idempotency_and_round_repair_v1.sql");

test("Atlas has one dock renderer with stable capability profiles instead of screen-specific docks", () => {
  assert.match(frame, /atlasDockProfileForRole/);
  assert.match(frame, /atlasDockKeys\(dockProfile\)/);
  assert.doesNotMatch(frame, /principalProjection\s*\?\s*\[/);
  assert.match(dockProfile, /type AtlasDockProfile = "full" \| "field_worker"/);
  assert.match(dockProfile, /role === "farm_hand" \? "field_worker" : "full"/);
  assert.match(dockProfile, /FULL_DOCK_KEYS[\s\S]*"manager"/);
  assert.doesNotMatch(dockProfile.match(/FIELD_WORKER_DOCK_KEYS[\s\S]*?\];/)?.[0] ?? "", /"manager"/);
});

test("Owner destinations use the universal full dock while Owner Work routes to My Work", () => {
  assert.match(frame, /isOwner \? "\/principal" : "\/"/);
  assert.match(frame, /isOwner \? "\/owner" : workHref/);
  assert.match(frame, /label: "Clock"/);
  assert.match(frame, /label: "Manager"/);
  assert.match(frame, /label: "Harvest"/);
  assert.match(frame, /label: "More"/);
});

test("farm-hand dated feeds preserve rollover semantics and only apply execution readiness", () => {
  assert.doesNotMatch(datedCards, /workerDateWindowAllows/);
  assert.doesNotMatch(datedCards, /hasExplicitCarryForward/);
  assert.doesNotMatch(datedCards, /calendar_rollover_policy/);
  assert.match(datedCards, /worker_executable_task_ids_v1/);
  assert.match(datedCards, /Unfinished work is never hidden merely because/);
  assert.match(datedCards, /if \(farmHandLens && workerMembershipId && workerFarmId\)/);
});

test("missing worker readiness becomes Owner work instead of a worker waiting-list item", () => {
  assert.match(ownerWork, /worker_task_execution_readiness/);
  assert.match(ownerWork, /needs a planting destination/);
  assert.match(ownerWork, /owner_decision_required/);
  assert.match(containment, /The task is withheld from the worker execution feed until the missing readiness is resolved\./);
  assert.match(containment, /Choose or confirm a canonical destination for/);
});

test("unfinished work automatically advances to the next worker day", () => {
  assert.match(restoredRollover, /unfinished_work_carries_forward_v1/);
  assert.match(restoredRollover, /worker_day_on_or_after_v1/);
  assert.match(restoredRollover, /Unfinished work moved to the next worker day\./);
  assert.match(repairedRollover, /calendar-rollover-v1:/);
  assert.doesNotMatch(repairedRollover, /heldForOwnerReview/);
  assert.doesNotMatch(repairedRollover, /calendar_rollover_policy/);
});

test("Farm Round is a rolling singleton and the first Morning execution card", () => {
  assert.match(farmRoundWindow, /p_action_key,''\)\)='farm_round'/);
  assert.match(farmRoundWindow, /p_task_type,''\)\)='stewardship_round'/);
  assert.match(farmRoundWindow, /then 'morning'/);
  assert.match(restoredRollover, /roll_farm_round_forward_v1/);
  assert.match(restoredRollover, /farmRoundDuplicateSuppressed/);
  assert.match(restoredRollover, /return 21000/);
  assert.match(repairedRollover, /Saturday Farm Round is a rolling singleton/);
});

test("Rainbow Swiss chard receives MG5 as canonical destination", () => {
  assert.match(restoredRollover, /stable_key='mg5'/);
  assert.match(restoredRollover, /transplant_destination','MG5'/);
  assert.match(restoredRollover, /Owner assigned Rainbow Swiss chard seedlings to MG5\./);
});

test("the worker execution-warrant batch helper is governed", () => {
  assert.match(registry, /worker_executable_task_ids_v1\(uuid,uuid,uuid\[\],date\)/);
  assert.match(registry, /'app_endpoint'/);
  assert.match(registry, /authenticated_execute_expected/);
});
