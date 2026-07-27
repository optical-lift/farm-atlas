import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("organization portals keep the Feast Guild title while farm employees keep farm context", () => {
  const home = read("app/page.tsx");

  assert.match(home, /organizationMembership\.role === "owner"/);
  assert.match(home, /viewer\.farmMemberships\.length === 0/);
  assert.match(home, /home\.organizationHome\?\.organization\.name/);
  assert.match(home, /"Feast Guild"/);
  assert.doesNotMatch(home, /singleVisibleFarmName/);
});

test("project tasks open their project workspace instead of the farm-only task route", () => {
  const home = read("app/page.tsx");
  const project = read("app/project/[projectId]/page.tsx");
  const tools = read("components/atlas/portfolio/ProjectTaskTools.tsx");
  const guard = read("app/ProjectTaskDestinationGuard.tsx");
  const route = read("app/api/atlas/project-tasks/[taskId]/destination/route.ts");
  const migration = read("supabase/migrations/20260728235500_project_task_destination_v1.sql");

  assert.match(home, /move\.kind !== "project_task"/);
  assert.match(home, /\?taskId=\$\{encodeURIComponent\(taskId\)\}#project-work/);
  assert.match(project, /selectedTaskId/);
  assert.match(project, /<ProjectTaskTools[\s\S]*selectedTaskId=\{selectedTaskId\}/);
  assert.match(tools, /data-project-task-selected/);
  assert.match(tools, /scrollIntoView/);

  assert.match(guard, /window\.location\.pathname !== "\/task"/);
  assert.match(guard, /project-tasks\/\$\{encodeURIComponent\(taskId\)\}\/destination/);
  assert.match(guard, /window\.location\.replace/);
  assert.match(route, /project_task_destination_v1/);
  assert.match(migration, /atlas\.can_read_project\(p\.id\)/i);
  assert.match(migration, /t\.task_scope = 'project'/i);
  assert.doesNotMatch(migration, /insert into atlas\.tasks/i);
});

test("mobile shell corners are viewport behavior rather than membership behavior", () => {
  const layout = read("app/layout.tsx");
  const css = read("app/atlas-shell-responsive.css");

  assert.match(layout, /import "\.\/atlas-shell-responsive\.css"/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.atlas-phone[\s\S]*border-radius: 0 !important/);
  assert.match(css, /\.atlas-phone-top[\s\S]*border-radius: 0 !important/);
  assert.doesNotMatch(css, /owner|consultant|farm_hand|Katie|Anna/i);
});
