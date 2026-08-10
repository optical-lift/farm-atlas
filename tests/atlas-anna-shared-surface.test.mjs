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
  const root = read("app/page.tsx");
  const home = read("components/atlas/home/AtlasUniversalHome.tsx");
  const reader = read("lib/atlas/universal-home.ts");
  const operatorReader = read("lib/atlas/operator-universal-home.ts");
  const layout = read("app/layout.tsx");
  const taskClient = read("lib/atlas/task-cards-client.ts");
  const authCore = read("lib/atlas/auth-core.js");
  const snapshotRoute = read("app/api/atlas/farm-snapshot/route.ts");

  assert.match(root, /getAtlasSession/);
  assert.match(root, /atlasUniversalViewerFromSession/);
  assert.match(root, /readAtlasOperatorUniversalHome/);
  assert.match(operatorReader, /readAtlasUniversalHome/);
  assert.match(root, /<AtlasUniversalHome/);
  assert.doesNotMatch(root, /AtlasHomePortal|FeastGuildPortfolioHome/);

  for (const marker of [
    "AtlasAppShell",
    "AtlasTopBar",
    "AtlasCard",
    "AtlasMetricStrip",
    "AtlasFooterActions",
    "Today",
    "This Week",
    "Atlas Scope",
    "/zones",
    "FieldLogDrawer",
    "fetchAtlasZoneRegistry",
  ]) {
    assert.match(home, new RegExp(marker.replaceAll("/", "\\/")));
  }

  assert.match(home, /data-atlas-home-portal="universal"/);
  assert.match(reader, /home_task_cards_v2|universal_home_v1/);
  assert.match(reader, /farmTaskMove/);
  assert.match(operatorReader, /owner_operator_universal_home_v1/);
  assert.doesNotMatch(layout, /AtlasRoleHomeRedirect/);
  assert.match(taskClient, /if \(pathname === "\/"\)/);
  assert.match(taskClient, /\/api\/atlas\/universal-task-cards/);

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
  const migration = read("supabase/migrations/20260721193551_atlas_restore_shared_member_read_surface.sql");

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

test("Anna gets cut-and-dry task results with detail behind Unfinished", () => {
  const detail = read("components/atlas/assigned-task-execution-shell.tsx");

  for (const label of [
    "Done",
    "Unfinished",
    "What happened?",
    "Partly done",
    "Problem found",
    "Move or close this card",
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
  assert.doesNotMatch(detail, /How did this move land\?/);
  assert.match(detail, /transition\("done"\)/);
  assert.match(detail, /transition\("partial"/);
  assert.match(detail, /transition\("blocked"/);
  assert.match(detail, /reschedule\(null, [^)]*"next_day"\)/);
  assert.match(detail, /TaskPrimaryResultControls/);
  assert.doesNotMatch(detail, /targetReached: outcome === "done"/);
});
