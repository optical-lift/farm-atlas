import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("root renders one authenticated Atlas home portal", () => {
  const root = read("app/page.tsx");
  const portal = read("components/atlas/home/AtlasHomePortal.tsx");
  const viewerContext = read("lib/atlas/viewer-context.ts");

  assert.match(root, /requireAtlasViewer/);
  assert.match(root, /<AtlasHomePortal viewer=\{viewer\}/);
  assert.doesNotMatch(root, /atlas-home-box-purple/);
  assert.doesNotMatch(root, /TaskLaunchHero/);

  assert.match(portal, /data-atlas-home-portal="shared"/);
  assert.match(portal, /atlas-home-box-purple/);
  assert.match(portal, /viewer\.farmName/);
  assert.match(portal, /data-atlas-viewer-role=\{viewer\.role\}/);
  assert.match(viewerContext, /atlasViewerFromSession/);
});

test("legacy Marshall route returns to the universal root", () => {
  const marshall = read("app/marshall/page.tsx");

  assert.match(marshall, /redirect\("\/"\)/);
  assert.doesNotMatch(marshall, /redirect\("\/manage"\)/);
  assert.doesNotMatch(marshall, /atlas-home-box-purple/);
  assert.doesNotMatch(marshall, /MarshallDashboard|MarshallTodayHero/);
});

test("home task data follows the signed-in membership", () => {
  const route = read("app/api/atlas/home-task-cards/route.ts");
  const viewer = read("lib/atlas/viewer.ts");
  const migration = read("supabase/migrations/20260722174500_universal_home_viewer_scope.sql");

  assert.match(route, /authorized\.access\.membership\.workerKey/);
  assert.match(route, /p_worker_key: workerKey/);
  assert.match(route, /home-membership-v2/);
  assert.doesNotMatch(route, /p_worker_key:\s*"anna"/);

  assert.match(viewer, /canManageFarm: membership\.role === "owner" \|\| membership\.role === "manager"/);
  assert.match(viewer, /canUseOwnerTools: membership\.role === "owner"/);

  assert.match(migration, /assigned_membership_id = v_marshall_membership_id/);
  assert.match(migration, /visibility_scope = 'assigned_worker'/);
  assert.match(migration, /assigned_membership_id = v_owner_membership_id/);
  assert.match(migration, /v_requested_worker_key is distinct from v_current_worker_key/);
  assert.match(migration, /task\.assigned_membership_id = v_current_membership_id/);
  assert.doesNotMatch(migration, /worker_key = 'anna'/);
});
