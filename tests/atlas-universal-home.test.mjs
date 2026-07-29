import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const universalMigration = "supabase/migrations/20260728211500_universal_atlas_home_read_model_v1.sql";
const parityMigration = "supabase/migrations/20260728233500_universal_home_role_parity_v1.sql";

test("root renders one universal Atlas home for every active membership shape", () => {
  const root = read("app/page.tsx");
  const universalHome = read("components/atlas/home/AtlasUniversalHome.tsx");
  const viewer = read("lib/atlas/viewer.ts");
  const reader = read("lib/atlas/universal-home.ts");
  const operatorReader = read("lib/atlas/operator-universal-home.ts");

  assert.match(root, /getAtlasSession/);
  assert.match(root, /atlasUniversalViewerFromSession/);
  assert.match(root, /readAtlasOperatorUniversalHome/);
  assert.match(operatorReader, /readAtlasUniversalHome/);
  assert.match(root, /<AtlasUniversalHome/);
  assert.doesNotMatch(root, /FeastGuildPortfolioHome|AtlasHomePortal/);
  assert.doesNotMatch(root, /atlasPortalViewerFromSession|atlasViewerFromSession/);

  assert.match(universalHome, /AtlasAppShell/);
  assert.match(universalHome, /AtlasTopBar/);
  assert.match(universalHome, /AtlasCard/);
  assert.match(universalHome, /AtlasMetricStrip/);
  assert.match(universalHome, /AtlasFooterActions/);
  assert.match(universalHome, /AtlasSectionHeading/);
  assert.match(universalHome, /AtlasStateBadge/);
  assert.match(universalHome, /data-atlas-home-portal="universal"/);
  assert.match(universalHome, /data-atlas-single-farm/);
  assert.match(universalHome, /Work in Motion/);
  assert.match(universalHome, /Atlas Scope/);
  assert.doesNotMatch(universalHome, /displayName|Project lead|Lex/);

  assert.match(viewer, /export type AtlasUniversalViewer/);
  assert.match(viewer, /farmMemberships: session\.memberships/);
  assert.match(viewer, /organizationMemberships: session\.organizationMemberships/);
  assert.match(reader, /universal_home_v1/);
  assert.match(reader, /buildMoves/);
  assert.match(reader, /buildDatedItems/);
  assert.match(reader, /projectTasks/);
});

test("the universal dashboard keeps the familiar Atlas home geometry for farm and project members", () => {
  const universalHome = read("components/atlas/home/AtlasUniversalHome.tsx");
  const layout = read("app/layout.tsx");
  const familiarCss = read("app/universal-home-familiar.css");

  for (const marker of [
    "atlas-home-grid",
    "atlas-home-task-hero",
    "atlas-task-controller",
    "atlas-daily-run-sheet",
    "atlas-route-sheet",
    "atlas-run-sheet-grid",
    "atlas-route-sheet-grid",
    "atlas-home-overview-row",
    "atlas-home-overview-week",
    "atlas-home-overview-month",
    "atlas-farm-snapshot-bar",
    "atlas-home-footer-row",
    "atlas-note-plus",
  ]) {
    assert.match(universalHome, new RegExp(marker));
  }

  assert.doesNotMatch(universalHome, /className=\{styles\.(?:hero|heroCard|overviewPair|overviewCard)\}/);
  assert.match(layout, /import "\.\/universal-home-familiar\.css"/);
  assert.match(familiarCss, /#work-board/);
  assert.match(familiarCss, /#scope-board/);
  assert.match(familiarCss, /grid-auto-rows:\s*96px/);
  assert.match(familiarCss, /data-atlas-single-farm="true"\][\s\S]*#scope-board/);
  assert.match(familiarCss, /atlas-home-closeout-footer-link\[href="#scope-board"\]/);
  assert.match(familiarCss, /grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("the prepared home reader combines farm and organization scope without weakening either", () => {
  const migration = read(universalMigration);

  assert.match(migration, /create or replace function atlas\.universal_home_v1/i);
  assert.match(migration, /atlas\.portfolio_home_v1\(v_organization_id\)/i);
  assert.match(migration, /atlas\.farm_snapshot_for_member_v1\(v_farm\.farm_id\)/i);
  assert.match(migration, /atlas\.home_task_cards_v2\(/i);
  assert.match(migration, /from atlas\.farm_memberships fm/i);
  assert.match(migration, /fm\.user_id = v_user_id/i);
  assert.match(migration, /v_farm\.role in \('owner', 'manager'\)/i);
  assert.match(migration, /'taskCards', v_task_cards/i);
  assert.match(migration, /'organizationHome', v_organization_home/i);
  assert.match(migration, /grant execute on function atlas\.universal_home_v1/i);
  assert.doesNotMatch(migration, /worker_key\s*=\s*'anna'/i);
});

test("project-only contributors receive real task-forward home cards instead of a separate portal", () => {
  const migration = read(parityMigration);
  const reader = read("lib/atlas/universal-home.ts");
  const home = read("components/atlas/home/AtlasUniversalHome.tsx");

  assert.match(migration, /'projectTasks', v_project_tasks/);
  assert.match(migration, /join atlas\.project_task_links ptl/i);
  assert.match(migration, /join atlas\.tasks t on t\.id = ptl\.task_id/i);
  assert.match(migration, /atlas\.can_read_project\(p\.id\)/i);
  assert.match(migration, /t\.task_scope = 'project'/i);
  assert.doesNotMatch(migration, /insert into atlas\.tasks/i);

  assert.match(reader, /export type AtlasUniversalProjectTask/);
  assert.match(reader, /kind: "project_task"/);
  assert.match(reader, /projectTaskMove/);
  assert.match(reader, /singleVisibleFarmName/);
  assert.match(reader, /visibleFarms\.size === 1/);

  assert.match(home, /home\.moves\.map/);
  assert.match(home, /\$\{home\.moves\.length\} open/);
  assert.match(home, /home\.moves\[0\]\?\.href/);
  assert.match(home, /!singleVisibleFarm/);
  assert.doesNotMatch(home, /FeastGuildPortfolioHome/);
});

test("legacy Marshall route returns to the universal root", () => {
  const marshall = read("app/marshall/page.tsx");

  assert.match(marshall, /redirect\("\/"\)/);
  assert.doesNotMatch(marshall, /redirect\("\/manage"\)/);
  assert.doesNotMatch(marshall, /atlas-home-box-purple/);
  assert.doesNotMatch(marshall, /MarshallDashboard|MarshallTodayHero/);
});

test("home task data follows the signed-in farm membership", () => {
  const route = read("app/api/atlas/home-task-cards/route.ts");
  const viewer = read("lib/atlas/viewer.ts");
  const migration = read("supabase/migrations/20260722174500_universal_home_viewer_scope.sql");
  const optimization = read("supabase/migrations/20260722181500_optimize_universal_home_card_read.sql");

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

  assert.match(optimization, /select coalesce\(array_agg\(task\.id\)/);
  assert.match(optimization, /card\.task_id = any\(v_task_ids\)/);
  assert.doesNotMatch(optimization, /join atlas\.tasks task on task\.id = card\.task_id/);
});
