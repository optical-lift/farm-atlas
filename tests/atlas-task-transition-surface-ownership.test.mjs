import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("farm, Owner, and project task results cross one HTTP transition boundary", () => {
  const route = read("app/api/atlas/task-transition/route.ts");
  const project = read("components/atlas/project-task-focus.tsx");
  const owner = read("app/owner/tasks/[taskId]/OwnerTaskActions.tsx");

  assert.equal(existsSync(new URL("../app/api/atlas/project-tasks/[taskId]/transition/route.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app/api/atlas/owner/tasks/[taskId]/transition/route.ts", import.meta.url)), false);
  assert.match(route, /projectTaskTransition/);
  assert.match(route, /transition_project_task_v1/);
  assert.match(route, /owner_operator_transition_project_task_v1/);
  assert.match(route, /owner_record_task_transition_v1/);
  assert.match(route, /worker_record_task_transition_v1/);
  assert.match(project, /postAtlasTaskTransition/);
  assert.match(owner, /postAtlasTaskTransition/);
  assert.doesNotMatch(project + owner, /\/api\/atlas\/(?:project-tasks|owner\/tasks)\/.*transition/);
});

test("project transitions keep project and Trail semantics instead of falling through to generic farm mutation", () => {
  const route = read("app/api/atlas/task-transition/route.ts");

  assert.match(route, /readAtlasProjectTaskFocus\(input\.taskId\)/);
  assert.match(route, /if \(!focus\) return null/);
  assert.match(route, /PROJECT_TRANSITIONS/);
  assert.match(route, /projectTransition: true/);
  assert.match(route, /const projectResponse = await projectTaskTransition\(input\)/);
  assert.match(route, /if \(projectResponse\) return projectResponse/);
});
