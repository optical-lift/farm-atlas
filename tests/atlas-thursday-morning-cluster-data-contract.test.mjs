import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const clusterMigration = read("supabase/migrations/20260804074000_thursday_morning_checklist_clusters_v2.sql");
const splitMigration = read("supabase/migrations/20260804074500_split_thursday_morning_into_four_tasks_v2.sql");
const capacityMigration = read("supabase/migrations/20260804075000_thursday_morning_cluster_capacity_order_v2.sql");

test("the original released task becomes rooms while three siblings are released independently", () => {
  assert.match(splitMigration, /Keep the already-released task as the room-check card/);
  assert.match(splitMigration, /room_task\.planned_occurrence_id/);
  assert.match(splitMigration, /community_thursday_wednesday_outdoor:/);
  assert.match(splitMigration, /community_thursday_wednesday_coffee_water:/);
  assert.match(splitMigration, /community_thursday_wednesday_trash:/);
  assert.match(splitMigration, /not exists \([\s\S]*existing\.planned_occurrence_id = sibling\.id/);
});

test("future cluster occurrences use distinct definitions and policies", () => {
  for (const cluster of ["outdoor", "coffee_water", "rooms", "trash"]) {
    assert.ok(clusterMigration.includes(`community_thursday_morning_cluster:${cluster}:v2`));
    assert.ok(clusterMigration.includes(`community_thursday_morning_cluster:${cluster}:v2:time_window`));
  }
  assert.match(clusterMigration, /new\.work_definition_id := v_definition_id/);
  assert.match(clusterMigration, /new\.release_policy_id := v_policy_id/);
  assert.match(clusterMigration, /maximum_active_instances = 1/);
});

test("old checklist records are retired rather than deleted", () => {
  assert.doesNotMatch(splitMigration, /delete from atlas\.task_execution_checklist_items/i);
  assert.match(splitMigration, /'retired',true/);
  assert.match(splitMigration, /migratedFromTemplate','community_thursday_morning_v1/);
});

test("the themed checklist seeder runs after the generic capacity refresh", () => {
  assert.match(capacityMigration, /drop trigger if exists seed_task_execution_checklist_v1/);
  assert.match(capacityMigration, /create trigger zzzz_seed_task_execution_checklist_v2/);
  assert.match(capacityMigration, /select atlas\.seed_task_execution_checklist_v1\(task\.id\)/);
});
