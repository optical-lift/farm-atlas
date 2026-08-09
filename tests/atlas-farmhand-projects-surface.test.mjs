import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectsPage = readFileSync(new URL("../app/projects/page.tsx", import.meta.url), "utf8");
const duplicateCleanup = readFileSync(
  new URL("../supabase/migrations/20260809204600_retire_duplicate_cafe_light_servings.sql", import.meta.url),
  "utf8",
);

test("farm hands get a calm Projects surface instead of the portfolio management dump", () => {
  assert.match(projectsPage, /const farmHandMode = viewer\.farmMemberships\.some/);
  assert.match(projectsPage, /!viewer\.canManageAnyFarm/);
  assert.match(projectsPage, /!viewer\.canManageAnyPortfolio/);
  assert.match(projectsPage, /\{!farmHandMode \? \(/);
  assert.match(projectsPage, /!farmHandMode && home\.attention\.length/);
  assert.match(projectsPage, /title=\{farmHandMode \? "Your worlds" : "Active worlds"\}/);
  assert.match(projectsPage, /CalmProjectBranch/);
  assert.match(projectsPage, /quests"\} inside/);
});

test("legacy cafe-light servings retire into the one combined Tuesday move", () => {
  assert.match(duplicateCleanup, /Hang conference-room café lights \+ porch solar lights/);
  assert.match(duplicateCleanup, /Anna — Hang Cafe Lights in Meeting Room/);
  assert.match(duplicateCleanup, /Anna — Hang Cafe Lights on Porch/);
  assert.match(duplicateCleanup, /project_pull_items[\s\S]+status='archived'/);
  assert.match(duplicateCleanup, /planned_work_occurrences[\s\S]+state='cancelled'/);
  assert.match(duplicateCleanup, /merged_into_task_id/);
});
