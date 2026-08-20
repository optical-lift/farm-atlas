import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260820185547_worker_done_requires_execution_authorization_v1.sql", import.meta.url),
  "utf8",
);

const route = readFileSync(
  new URL("../app/api/atlas/task-transition/route.ts", import.meta.url),
  "utf8",
);

const normalized = migration.replace(/\s+/g, " ").trim();

test("farm-hand Done requires canonical execution readiness and routed-day authorization", () => {
  assert.match(migration, /if p_transition = 'done' then/);
  assert.match(migration, /atlas\.task_execution_readiness_v1\(p_task_id\)/);
  assert.match(migration, /atlas\.worker_state_transition_card_v2\(/);
  assert.match(migration, /\{transition,state\}/);
  assert.match(migration, /authorized_for_routed_day/);
  assert.match(migration, /using errcode = '23514'/);
});

test("the Worker Done gate fails inward before canonical completion is recorded", () => {
  const gateIndex = normalized.indexOf("if p_transition = 'done' then");
  const recordIndex = normalized.indexOf("return atlas.record_task_transition_v1");
  assert.ok(gateIndex >= 0, "Done gate must exist");
  assert.ok(recordIndex > gateIndex, "authorization must be checked before canonical completion is recorded");
});

test("the execution gate is generic rather than task-title or instance hardcoding", () => {
  assert.doesNotMatch(migration, /Chicken Chore/i);
  assert.doesNotMatch(migration, /Mow Corral/i);
  assert.doesNotMatch(migration, /Cub Cadet/i);
  assert.doesNotMatch(migration, /0ac62ed1-83e7-44da-85b3-cfdf01c5ae97/i);
  assert.doesNotMatch(migration, /b8ce42aa-387f-4f8c-8ce9-cc5384efbdae/i);
});

test("the task-transition API returns a truthful conflict instead of a generic server failure", () => {
  assert.match(route, /error\.code === "23514"/);
  assert.match(route, /task_execution_not_authorized/);
  assert.match(route, /This work is not executable in current farm reality/);
});
