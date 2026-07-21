import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function functionBody(source, name, nextName) {
  const start = source.indexOf(`export async function ${name}`);
  const end = nextName ? source.indexOf(`export async function ${nextName}`, start + 1) : source.length;
  assert.notEqual(start, -1, `${name} was not found`);
  return source.slice(start, end === -1 ? source.length : end);
}

test("Anna enters the familiar shared Atlas operating surface", () => {
  const home = read("app/page.tsx");
  const layout = read("app/layout.tsx");
  const taskClient = read("lib/atlas/task-cards-client.ts");
  const authCore = read("lib/atlas/auth-core.js");
  const snapshotRoute = read("app/api/atlas/farm-snapshot/route.ts");

  for (const marker of [
    "TaskLaunchHero",
    "atlas-home-box-purple",
    "atlas-home-task-hero",
    "atlas-home-overview-week",
    "atlas-home-overview-month",
    "atlas-farm-snapshot-bar",
    "/overview/week",
    "/overview/month",
    "/zones",
    "/production",
    "FieldLogDrawer",
    "fetchAtlasCloseout",
  ]) {
    assert.match(home, new RegExp(marker.replaceAll("/", "\\/")));
  }

  assert.doesNotMatch(layout, /AtlasRoleHomeRedirect/);
  assert.match(taskClient, /window\.location\.pathname === "\/"/);
  assert.match(taskClient, /\/api\/atlas\/home-task-cards/);

  for (const role of ["owner", "manager", "farm_hand"]) {
    assert.match(authCore, new RegExp(`case "${role}"`));
  }
  assert.match(authCore, /return "\/";/);
  assert.doesNotMatch(authCore, /return "\/(?:owner|manage|work\/today)"/);

  assert.match(snapshotRoute, /requireAtlasApiAccess\(\)/);
  assert.match(snapshotRoute, /farm_snapshot_for_member_v1/);
  assert.doesNotMatch(snapshotRoute, /atlasSupabase|SUPABASE_SERVICE_ROLE_KEY/);
});

test("production plans are shared reads with owner-only controls", () => {
  const page = read("app/production/page.tsx");
  const planRoute = read("app/api/atlas/production-plans/route.ts");
  const dashboardRoute = read("app/api/atlas/production-dashboard/route.ts");
  const migration = read("supabase/migrations/20260721193000_atlas_restore_shared_member_read_surface.sql");

  for (const route of [planRoute, dashboardRoute]) {
    const getBody = functionBody(route, "GET", "PATCH");
    const patchBody = functionBody(route, "PATCH");

    assert.match(getBody, /requireAtlasApiAccess\(\)/);
    assert.doesNotMatch(getBody, /allowedRoles/);
    assert.match(getBody, /loadSharedProductionPlans/);
    assert.match(getBody, /canManageProduction: role === "owner"/);

    assert.match(patchBody, /allowedRoles: \["owner"\]/);
    assert.match(patchBody, /owner_update_production_/);
  }

  assert.match(page, /canManageProduction/);
  assert.match(page, /if \(!canManage\)/);
  assert.match(page, /!loading && canManageProduction/);
  assert.match(page, /Shared crop plan view\. Owner controls stay private\./);
  assert.match(page, /\{canManageProduction \? \(/);
  assert.match(page, /Open sowing task/);

  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /atlas\.farm_memberships/);
  assert.match(migration, /shared_production_plans_v1/);
  assert.match(migration, /farm_snapshot_for_member_v1/);
  assert.match(migration, /revoke all .* from public/is);
  assert.match(migration, /revoke all .* from anon/is);
  assert.match(migration, /grant execute .* to authenticated/is);
});

test("Anna retains the full task outcome vocabulary", () => {
  const detail = read("components/atlas/canonical-assigned-task-detail.tsx");

  for (const label of [
    "Unfinished",
    "What happened?",
    "Partly done",
    "Blocked",
    "Reschedule",
    "Tomorrow",
    "Next week",
    "Pick a date",
    "Close without doing it",
    "Changed plan",
    "Not relevant",
  ]) {
    assert.match(detail, new RegExp(label.replace(/[?]/g, "\\?")));
  }
  assert.match(detail, /scheduleIntent: "next_day"/);
});
