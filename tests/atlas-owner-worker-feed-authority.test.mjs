import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const datedCards = read("app/api/atlas/universal-task-cards/route.ts");
const ownerWork = read("lib/atlas-data/owner-my-work.ts");
const containment = read("supabase/migrations/20260823131644_worker_feed_readiness_and_rollover_containment_v1.sql");
const farmRound = read("supabase/migrations/20260823132438_farm_round_worker_day_position_v1.sql");
const registry = read("supabase/migrations/20260823132603_worker_executable_task_ids_rpc_registry_v1.sql");

test("Owner navigation is role-authoritative and Work routes to Owner My Work", () => {
  assert.match(frame, /ownerMode \? "\/principal" : "\/"/);
  assert.match(frame, /ownerMode \? "\/owner" : workHref/);
  assert.doesNotMatch(frame, /principalProjection\s*\?\s*\[/);
  assert.match(frame, /label: "Clock"/);
  assert.match(frame, /label: "Harvest"/);
  assert.match(frame, /label: "More"/);
});

test("farm-hand dated feeds require both current-date authority and execution readiness", () => {
  assert.match(datedCards, /workerDateWindowAllows/);
  assert.match(datedCards, /calendar_rollover_policy/);
  assert.match(datedCards, /worker_executable_task_ids_v1/);
  assert.match(datedCards, /if \(farmHandLens && workerMembershipId && workerFarmId\)/);
});

test("missing worker readiness becomes Owner work instead of a worker waiting-list item", () => {
  assert.match(ownerWork, /worker_task_execution_readiness/);
  assert.match(ownerWork, /needs a planting destination/);
  assert.match(ownerWork, /owner_decision_required/);
  assert.match(containment, /The task is withheld from the worker execution feed until the missing readiness is resolved\./);
  assert.match(containment, /Choose or confirm a canonical destination for/);
});

test("expired dated work does not silently roll onto a later Worker Day", () => {
  assert.match(containment, /worker_calendar_rollover_explicit_v2/);
  assert.match(containment, /calendar_rollover_policy/);
  assert.match(containment, /heldForOwnerReview/);
  assert.match(containment, /This dated serving expired; it does not silently carry into a later Worker Day\./);
  assert.match(containment, /anna_20260805_school_preschool_enrollment/);
  assert.match(containment, /anna_20260814_upload_friday_farm_posy_photos_icloud/);
  assert.match(containment, /anna_farm_round_20260822/);
});

test("Farm Round belongs to the morning stewardship route", () => {
  assert.match(farmRound, /p_action_key,''\)\)='farm_round'/);
  assert.match(farmRound, /p_task_type,''\)\)='stewardship_round'/);
  assert.match(farmRound, /then 'morning'/);
});

test("the worker execution-warrant batch helper is governed", () => {
  assert.match(registry, /worker_executable_task_ids_v1\(uuid,uuid,uuid\[\],date\)/);
  assert.match(registry, /'app_endpoint'/);
  assert.match(registry, /authenticated_execute_expected/);
});
