import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectsPage = readFileSync(new URL("../app/projects/page.tsx", import.meta.url), "utf8");
const projectPage = readFileSync(new URL("../app/project/[projectId]/page.tsx", import.meta.url), "utf8");
const portfolio = readFileSync(new URL("../lib/atlas/portfolio.ts", import.meta.url), "utf8");
const control = readFileSync(new URL("../components/atlas/portfolio/ProjectRealityStateControl.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/atlas/project-reality-state/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260809234500_multifarm_reality_projects_v1.sql", import.meta.url), "utf8");

test("Owner Projects is scoped by farms and opens as a blocker-first All Farms map", () => {
  assert.match(projectsPage, />All Farms</);
  assert.match(projectsPage, /Needs you now/);
  assert.match(projectsPage, /FarmHomeLane/);
  assert.match(projectsPage, /home\.farms\.map/);
  assert.match(projectsPage, /farm\.northStar/);
  assert.match(projectsPage, /farm\.locationLabel/);
  assert.match(projectsPage, /MiniRealityTrail/);
  assert.match(projectsPage, /Finding the shape/);
  assert.match(projectsPage, /Making it real/);
  assert.match(projectsPage, /Closing the loop/);
  assert.match(projectsPage, /Across the farms/);
});

test("farm scope keeps the North Star above Worlds and collapses Quests", () => {
  assert.match(projectsPage, /selectedFarm\.northStar/);
  assert.match(projectsPage, /AtlasSectionHeading title="Worlds"/);
  assert.match(projectsPage, /atlas-world-quests/);
  assert.match(projectsPage, /childrenByParent/);
  assert.match(projectsPage, /No active worlds yet/);
});

test("project detail explains certainty before showing quests and Moves", () => {
  assert.match(projectPage, /What has to become true next/);
  assert.match(projectPage, />Quests</);
  assert.match(projectPage, /Moves advancing this/);
  assert.match(projectPage, /project\.realityStateReason/);
  assert.match(projectPage, /ProjectRealityStateControl/);
  assert.match(projectPage, /All project work \+ controls/);
});

test("reality state is explicit Owner-governed data rather than task-count progress", () => {
  assert.match(portfolio, /AtlasRealityState = "finding_shape" \| "making_real" \| "closing_loop"/);
  assert.match(portfolio, /realityState: AtlasRealityState/);
  assert.match(portfolio, /northStar: string \| null/);
  assert.match(migration, /add column if not exists reality_state/);
  assert.match(migration, /add column if not exists north_star_text/);
  assert.match(migration, /waiting_room_farm/);
  assert.match(migration, /set_project_reality_state_v1/);
  assert.match(migration, /Only the organization Owner may change a project reality state/);
  assert.doesNotMatch(projectsPage, /openTaskCount\s*\/|% complete|percentComplete/i);
});

test("Owner certainty changes use the governed same-origin route", () => {
  assert.match(control, /project-reality-state/);
  assert.match(control, /router\.refresh/);
  assert.match(route, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(route, /allowedRoles: \["owner"\]/);
  assert.match(route, /set_project_reality_state_v1/);
  assert.match(migration, /authenticated_rpc_registry/);
  assert.match(migration, /atlas\.set_project_reality_state_v1\(uuid,text,text\)/);
});
