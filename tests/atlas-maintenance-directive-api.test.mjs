import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const objectRoute = readFileSync(new URL("../app/api/atlas/objects/[objectKey]/maintenance-directives/route.ts", import.meta.url), "utf8");
const taskRoute = readFileSync(new URL("../app/api/atlas/maintenance-directives/route.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/atlas/maintenance-directives-client.ts", import.meta.url), "utf8");

test("object authoring requires an explicit intent and management role", () => {
  assert.match(objectRoute, /object-maintenance-directive-v1/);
  assert.match(objectRoute, /allowedRoles: \["owner", "manager"\]/);
  assert.match(objectRoute, /create_object_maintenance_directive_v1/);
  assert.match(objectRoute, /cancel_maintenance_directive_v1/);
  assert.match(objectRoute, /private, no-store/);
});

test("task reader and checklist mutation use signed-in task visibility", () => {
  assert.match(taskRoute, /maintenance_directives_for_task_v1/);
  assert.match(taskRoute, /maintenance-directive-step-v1/);
  assert.match(taskRoute, /set_maintenance_directive_step_v1/);
  assert.match(taskRoute, /requireAtlasApiAccess\(\)/);
  assert.match(taskRoute, /private, no-store/);
});

test("client creates idempotent object-first directives", () => {
  assert.match(client, /maintenance-directive:\$\{objectKey\}:\$\{Date\.now\(\)\}:\$\{crypto\.randomUUID\(\)\}/);
  assert.match(client, /cropCycleIds/);
  assert.match(client, /steps/);
  assert.match(client, /workWindowKey/);
  assert.match(client, /effectPolicy/);
});
