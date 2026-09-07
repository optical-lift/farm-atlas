import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("A1 quarantines the only inventoried prose-first application writers", () => {
  const guard = read("lib/atlas/structured-work-authoring-guard.ts");
  const manual = read("app/api/atlas/manual-task/route.ts");
  const project = read("app/api/atlas/projects/[projectId]/tasks/route.ts");
  const inventory = read("docs/architecture/structured-work-a1-legacy-writers.md");

  assert.match(guard, /"manual-task-v1"/);
  assert.match(guard, /"project-task-v1"/);
  assert.match(guard, /Unregistered prose-first work writer/);

  assert.match(manual, /assertLegacyProseWorkWriterRegistered\("manual-task-v1"\)/);
  assert.match(project, /assertLegacyProseWorkWriterRegistered\("project-task-v1"\)/);

  assert.match(inventory, /create_manual_task_v1/);
  assert.match(inventory, /owner_operator_create_project_task_v1/);
  assert.match(inventory, /create_project_task_v1/);
  assert.match(inventory, /compatibility debt/i);
  assert.match(inventory, /No new application-level operational writer may establish work meaning through prose alone/);
});

test("A1 enforces title-only employee task exposure until disclosure architecture exists", () => {
  const delivery = read("lib/worker-delivery.ts");
  const client = read("app/anna/AnnaWorkerDayClient.tsx");
  const drawer = read("app/anna/EmployerPocket.tsx");

  assert.doesNotMatch(delivery, /work_items[\s\S]{0,300}instructions/);
  assert.doesNotMatch(delivery, /instructions:/);
  assert.doesNotMatch(delivery, /sourceWork/);
  assert.doesNotMatch(delivery, /details:/);

  assert.doesNotMatch(client, /instructions/);
  assert.doesNotMatch(client, /sourceWork/);
  assert.doesNotMatch(client, /item\.details/);
  assert.match(client, /detail:\s*\{[\s\S]*id: item\.id,[\s\S]*title: item\.title,[\s\S]*completed: item\.completed/);

  assert.doesNotMatch(drawer, /instructions/);
  assert.doesNotMatch(drawer, /sourceWork/);
  assert.doesNotMatch(drawer, /selectedTask\.details/);
  assert.match(drawer, /selectedTask\.title/);
});
