import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20260729010000_universal_trail_task_release_and_pulse_v1.sql";
const migration = fs.readFileSync(migrationPath, "utf8");

test("Trail task releases have one active current move and stable task identity", () => {
  assert.match(migration, /create table if not exists atlas\.trail_task_releases/i);
  assert.match(migration, /unique \(trail_binding_id, node_key, task_id\)/i);
  assert.match(migration, /create unique index if not exists trail_task_releases_one_active_current_idx/i);
  assert.match(migration, /where release_status = 'active' and release_role = 'current'/i);
});

test("new project work attaches to the current Trail node instead of manufacturing a future task", () => {
  assert.match(migration, /create or replace function atlas\.create_project_task_v1/i);
  assert.match(migration, /coalesce\(v_binding\.node_order, v_sort_order\)/i);
  assert.match(migration, /'trail_node_key',v_binding\.current_node_key/i);
  assert.match(migration, /release_project_task_to_current_trail_v1\(v_project\.id, v_task_id, null\)/i);
  assert.doesNotMatch(migration, /insert into atlas\.tasks[\s\S]*trail_profile_nodes[\s\S]*cross join/i);
});

test("completion records evidence and advances only after every released task at the node resolves", () => {
  assert.match(migration, /insert into atlas\.trail_evidence_links/i);
  assert.match(migration, /source_type, source_id, evidence_status/i);
  assert.match(migration, /atlas\.promote_next_trail_release_v1/i);
  assert.match(migration, /select count\(\*\)::integer into v_active_release_count/i);
  assert.match(migration, /if v_active_release_count = 0 and exists/i);
  assert.match(migration, /current_node_key = v_next_node_key/i);
});

test("unfinished outcomes preserve Trail truth without false advancement", () => {
  assert.match(migration, /when v_transition in \('not_relevant','changed_plan'\) then 'skipped'/i);
  assert.match(migration, /set release_status = 'cancelled'/i);
  assert.match(migration, /if v_release\.release_role = 'current' then[\s\S]*promote_next_trail_release_v1/i);
  const transitionBlock = migration.match(/create or replace function atlas\.transition_project_task_v1[\s\S]*?grant execute on function atlas\.transition_project_task_v1/i)?.[0] ?? "";
  assert.doesNotMatch(transitionBlock, /current_node_key = v_next_node_key/i);
});

test("project Trail context chooses the active current release rather than the oldest linked step", () => {
  assert.match(migration, /from atlas\.trail_task_releases r[\s\S]*r\.release_status = 'active' and r\.release_role = 'current'/i);
  assert.match(migration, /when linked_task_id is null or release_status <> 'active' or release_role <> 'current' then null/i);
  assert.match(migration, /'href','\/task-focus\/' \|\| linked_task_id::text/i);
});

test("the universal Trail pulse distinguishes blocked, missing, review, waiting, and moving", () => {
  assert.match(migration, /create or replace function atlas\.universal_trail_pulse_v1/i);
  for (const state of ["blocked", "missing_release", "review", "waiting", "moving"]) {
    assert.match(migration, new RegExp(`'${state}'`, "i"));
  }
  assert.match(migration, /atlas\.can_read_trail_binding_v1\(b\.id\)/i);
  assert.match(migration, /when task_id is not null then '\/task-focus\/'/i);
});
