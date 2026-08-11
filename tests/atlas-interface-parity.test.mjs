import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("organization portals keep the Feast Guild title while farm employees keep farm context", () => {
  const home = read("app/page.tsx");

  assert.match(home, /organizationMembership\.role === "owner"/);
  assert.match(home, /renderedViewer\.farmMemberships\.length === 0/);
  assert.match(home, /home\.organizationHome\?\.organization\.name/);
  assert.match(home, /"Feast Guild"/);
  assert.doesNotMatch(home, /singleVisibleFarmName/);
});

test("project Moves keep the same task-focus route beneath the strategic project horizon", () => {
  const project = read("app/project/[projectId]/page.tsx");
  const tools = read("components/atlas/portfolio/ProjectTaskTools.tsx");
  const focusRoute = read("app/task-focus/[taskId]/page.tsx");
  const focus = read("components/atlas/project-task-focus.tsx");
  const transitionRoute = read("app/api/atlas/task-transition/route.ts");
  const legacyTaskLayout = read("app/task/layout.tsx");
  const migration = read("supabase/migrations/20260728235900_universal_project_task_focus_and_transitions_v1.sql");
  const css = read("app/project-task-timeline.css");

  assert.match(project, /atlas-project-horizon/);
  assert.match(project, /Moves advancing this/);
  assert.match(project, /<ProjectTaskTools[\s\S]*steps=\{detail\.steps\}[\s\S]*trail=\{project\.trail\}/);
  assert.doesNotMatch(project, /<AtlasTrail/);
  assert.doesNotMatch(project, /className=\{styles\.hero\}/);

  assert.match(tools, /atlas-day-route-spine atlas-project-route-spine/);
  assert.match(tools, /atlas-day-task-node atlas-project-task-node/);
  assert.match(tools, /\/task-focus\/\$\{encodeURIComponent\(task\.taskId\)\}/);
  assert.doesNotMatch(tools, /complete_project_task|\/complete`|>Done</);

  assert.match(focusRoute, /readAtlasProjectTaskFocus/);
  assert.match(focusRoute, /<ProjectTaskFocus focus=\{projectFocus\}/);
  assert.match(focus, /atlas-task-ticket-card atlas-dominion-task-card/);
  assert.match(focus, /<AtlasTrail context=\{project\.trail\} mode="compact"/);
  assert.match(focus, /postAtlasTaskTransition/);
  assert.doesNotMatch(focus, /\/api\/atlas\/project-tasks/);
  assert.match(transitionRoute, /projectTaskTransition/);
  assert.match(transitionRoute, /transition_project_task_v1/);
  assert.match(focus, /const destination = returnTo \|\| `\/project\/\$\{encodeURIComponent\(project\.projectId\)\}`/);
  assert.match(legacyTaskLayout, /\/task-focus\/\$\{encodeURIComponent\(taskId\)\}/);

  assert.match(migration, /atlas\.project_task_focus_v1/i);
  assert.match(migration, /atlas\.transition_project_task_v1/i);
  assert.match(migration, /atlas\.can_read_project\(p\.id\)/i);
  assert.match(css, /Projects use the same Atlas collection grammar as Day and Week/);
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
