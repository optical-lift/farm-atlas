import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260815142000_harvest_flower_preparation_ready_v1.sql");
const registry = read("supabase/migrations/20260815142100_harvest_flower_preparation_ready_rpc_registry_v1.sql");
const writeRoute = read("app/api/atlas/flower-preparation/route.ts");
const contextRoute = read("app/api/atlas/flower-preparation-context/route.ts");
const projectionRoute = read("app/api/atlas/flower-postharvest/route.ts");
const focus = read("app/task-focus/[taskId]/FlowerPreparationFocusPage.tsx");
const loader = read("components/atlas/flower-preparation-task-loader.tsx");
const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const harvested = read("app/harvest/HarvestedOutputSection.tsx");
const projection = read("app/harvest/FlowerPostharvestSection.tsx");

test("completed preparation owns immutable harvested-input lineage and Ready birth truth", () => {
  assert.match(migration, /create table atlas\.flower_preparation_batches/i);
  assert.match(migration, /create table atlas\.flower_preparation_inputs/i);
  assert.match(migration, /create table atlas\.flower_ready_inventory_lots/i);
  assert.match(migration, /unique \(harvest_observation_id\)/i);
  assert.match(migration, /flower_preparation_batches_append_only_v1/i);
  assert.match(migration, /flower_preparation_inputs_append_only_v1/i);
  assert.match(migration, /flower_ready_inventory_lots_append_only_v1/i);
  assert.match(migration, /Ready inventory requires harvested preparation input/i);
  assert.match(migration, /A no-saleable-output preparation cannot create Ready inventory/i);
});

test("Ready inventory has explicit product semantics rather than inferred harvest quantity", () => {
  for (const kind of ["conditioned_bucket", "counted_stems", "posy", "bouquet", "lobby_arrangement"]) {
    assert.match(migration, new RegExp(kind));
    assert.match(focus, new RegExp(kind));
  }
  assert.match(migration, /quantity_exactness in \('exact','lower_bound'\)/i);
  assert.match(migration, /Only conditioned bucket output may remain a lower bound/i);
  assert.match(focus, /Count stems only when the sale unit itself requires stems/);
  assert.match(focus, /Harvested flowers do not become Ready automatically/);
});

test("harvest physical output releases preparation through the existing obligation membrane", () => {
  assert.match(migration, /ensure_flower_preparation_task_v1/i);
  assert.match(migration, /p_task_type=>'flower_preparation'/i);
  assert.match(migration, /p_maximum_active_instances=>1/i);
  assert.match(migration, /p_gate_type=>'event'/i);
  assert.match(migration, /signal_work_occurrence_v1/i);
  assert.match(migration, /harvest_output_recorded/i);
  assert.match(migration, /flower_harvest_bucket_observations_queue_preparation_v1/i);
  assert.match(migration, /Worker Day\/Clock still owns placement/i);
  assert.doesNotMatch(migration, /planned_start_at\s*=/i);
});

test("preparation result writes through membership-scoped RPCs and canonical task transition", () => {
  assert.match(migration, /record_flower_preparation_core_v1/i);
  assert.match(migration, /record_flower_preparation_for_member_v1/i);
  assert.match(migration, /owner_operator_record_flower_preparation_v1/i);
  assert.match(migration, /record_task_transition_v1_internal/i);
  assert.match(writeRoute, /record_flower_preparation_for_member_v1/);
  assert.match(writeRoute, /owner_operator_record_flower_preparation_v1/);
  assert.match(writeRoute, /flower-preparation-ready-v1/);
  assert.doesNotMatch(writeRoute, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);
  assert.match(registry, /app_endpoint/);
  assert.match(registry, /owner_admin_endpoint/);
});

test("flower preparation uses specialized Task Focus with unprepared harvested inputs only", () => {
  assert.match(canonical, /isFlowerPreparationTask/);
  assert.match(canonical, /FlowerPreparationTaskLoader/);
  assert.match(loader, /flower-preparation-context/);
  assert.match(contextRoute, /from\("flower_harvest_bucket_observations"\)/);
  assert.match(contextRoute, /from\("flower_preparation_inputs"\)/);
  assert.match(contextRoute, /consumedIds/);
  assert.match(focus, /What is Ready now\?/);
});

test("Harvest tab projects Prepare and Ready from their own canonical truths", () => {
  assert.match(harvested, /FlowerPostharvestSection/);
  assert.match(projection, /title="Prepare"/);
  assert.match(projection, /title="Ready"/);
  assert.match(projectionRoute, /from\("flower_harvest_bucket_observations"\)/);
  assert.match(projectionRoute, /from\("flower_preparation_inputs"\)/);
  assert.match(projectionRoute, /from\("flower_ready_inventory_lots"\)/);
  assert.match(projection, /No forecast or raw harvest is promoted into inventory/);
});

test("Elm bucket preparation does not revive the unused stem-count custody engine", () => {
  for (const source of [migration, writeRoute, contextRoute, projectionRoute, focus, projection]) {
    assert.doesNotMatch(source, /production_harvest_lots|production_harvest_stand_entries|production_harvest_container_assignments|production_postharvest_gates|postharvest_containers|postharvest_container_events/);
  }
});
