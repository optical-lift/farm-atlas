import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const personalMigration = read("supabase/migrations/20260804053500_atlas_strict_personal_work_scope_v1.sql");
const managementMigration = read("supabase/migrations/20260804052000_atlas_personal_work_and_manager_big_picture_v1.sql");
const workAlongsideRoute = read("app/api/atlas/work-alongside/route.ts");
const workAlongsideOverlay = read("components/atlas/work-alongside/AtlasWorkAlongsideOverlay.tsx");
const shell = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const dock = read("components/atlas/shell/AtlasDock.tsx");
const layout = read("app/layout.tsx");
const morePage = read("app/more/page.tsx");
const farmDayPage = read("app/manage/day/page.tsx");
const managerDaySurface = read("components/atlas/manage/ManagerDaySurface.tsx");
const effectiveAccess = read("lib/atlas/effective-management-access.ts");

const personalReader = personalMigration.match(/CREATE OR REPLACE FUNCTION atlas\.home_task_cards_for_membership_v2[\s\S]*?\$function\$;/)?.[0] ?? "";
const signedInReader = managementMigration.match(/CREATE OR REPLACE FUNCTION atlas\.home_task_cards_v2[\s\S]*?\$function\$;/)?.[0] ?? "";

test("normal Work is membership-personal and cross-person work requires an explicit window", () => {
  assert.match(personalReader, /assigned_membership_id = p_membership_id/);
  assert.match(personalReader, /assigned_user_id = v_user_id/);
  assert.match(personalReader, /work_alongside_windows/);
  assert.doesNotMatch(personalReader, /shared_with_membership_ids/);
  assert.doesNotMatch(signedInReader, /cross join lateral atlas\.home_task_cards_for_membership_v2/i);
});

test("Owner and Manager can configure work-alongside through the effective account", () => {
  assert.match(workAlongsideRoute, /readAtlasOwnerOperatorContext/);
  assert.match(workAlongsideRoute, /operatorContext\?\.isOperating/);
  assert.match(workAlongsideRoute, /effective\.farmMembershipId/);
  assert.match(workAlongsideRoute, /effective\.farmRole/);
  assert.match(workAlongsideRoute, /Farm management membership required/);
  assert.match(workAlongsideRoute, /observer_membership_id/);
  assert.match(workAlongsideRoute, /teammate_membership_id/);
  assert.doesNotMatch(workAlongsideRoute, /assigned_membership_id/);
});

test("management is a separate role-aware dock destination rather than an inner Work toggle", () => {
  assert.match(managementMigration, /farm_day_task_cards_v1/);
  assert.match(managementMigration, /v_role NOT IN \('owner', 'manager'\)/);
  assert.match(shell, /label: "Manager"/);
  assert.match(shell, /<AtlasDock items=\{items\} active=\{active\} \/>/);
  assert.match(dock, /kind === "manager"/);
  assert.match(shell, /effectiveFarmRole === "owner" \|\| effectiveFarmRole === "manager"/);
  assert.match(layout, /effectiveFarmRole = operatorContext\?\.isOperating/);
  assert.match(layout, /AtlasContextualAppFrame effectiveFarmRole=\{effectiveFarmRole\}/);
  assert.match(farmDayPage, /requireAtlasEffectiveManagementAccess/);
  assert.match(farmDayPage, /farm_day_task_cards_v1/);
  assert.match(farmDayPage, /<ManagerDaySurface/);
  assert.match(managerDaySurface, /atlas-phone-kicker">Manager/);
  assert.doesNotMatch(managerDaySurface, />My work</);
  assert.doesNotMatch(managerDaySurface, />Big picture</);
  assert.doesNotMatch(workAlongsideOverlay, /atlas-day-management-lens-tabs/);
  assert.doesNotMatch(morePage, /label: "Farm day"/);
});

test("Manager uses one shared Work-page shell and Day task grammar", () => {
  assert.match(farmDayPage, /ManagerDaySurface/);
  assert.match(managerDaySurface, /atlas-phone-shell atlas-home-shell atlas-task-page-shell/);
  assert.match(managerDaySurface, /atlas-phone atlas-dashboard-phone atlas-task-page-phone/);
  assert.match(managerDaySurface, /atlas-phone-top atlas-dashboard-top/);
  assert.match(managerDaySurface, /atlas-phone-brand atlas-task-header-brand/);
  assert.match(managerDaySurface, /atlas-task-page-body/);
  assert.match(managerDaySurface, /atlas-task-page-section atlas-route-collection atlas-day-browse/);
  assert.match(managerDaySurface, /atlas-day-browse-head/);
  assert.match(managerDaySurface, /atlas-day-command-header/);
  assert.match(managerDaySurface, /atlas-day-command-overview/);
  assert.match(managerDaySurface, /atlas-day-overdue-group/);
  assert.match(managerDaySurface, /atlas-day-work-order-group atlas-day-timeline-group/);
  assert.match(managerDaySurface, /atlas-day-route-spine/);
  assert.match(managerDaySurface, /atlas-day-task-entry/);
  assert.match(managerDaySurface, /atlas-day-task-node/);
  assert.match(managerDaySurface, /atlas-day-task-card atlas-journal-task-row/);
  assert.match(managerDaySurface, /atlas-journal-task-detail/);
  assert.doesNotMatch(managerDaySurface, /farm-day\.module\.css/);
  assert.doesNotMatch(managerDaySurface, /styles\./);
  assert.doesNotMatch(managerDaySurface, /Every person’s assigned work/);
  assert.doesNotMatch(managerDaySurface, /peoplePill/);
});

test("every Manager task resolves canonical Owner, Anna, and Marshall identity into a durable badge", () => {
  assert.match(managerDaySurface, /resolveTaskAssignee/);
  assert.match(managerDaySurface, /canonical = resolveTaskAssignee\(task\)/);
  assert.match(managerDaySurface, /function ManagerAssigneeBadge/);
  assert.match(managerDaySurface, /atlas-manager-assignee-host/);
  assert.match(managerDaySurface, /atlas-manager-assignee-badge/);
  assert.match(managerDaySurface, /data-assignee-key=\{executor\.key\}/);
  assert.match(managerDaySurface, /data-assignee-key="anna"/);
  assert.match(managerDaySurface, /data-assignee-key="marshall"/);
  assert.match(managerDaySurface, /data-assignee-key="owner"/);
  assert.match(managerDaySurface, /<dt>Assigned to<\/dt><dd>\{executor\.label\}<\/dd>/);
  assert.match(managerDaySurface, /prefetch=\{false\}/);
  assert.doesNotMatch(managerDaySurface, /data-atlas-assignee-label/);
  assert.doesNotMatch(managerDaySurface, /Assigned work/);
});

test("effective management access and More mirror the switched identity", () => {
  assert.match(effectiveAccess, /operatorContext\?\.isOperating/);
  assert.match(effectiveAccess, /effective\.farmRole/);
  assert.match(morePage, /operatorContext\?\.isOperating/);
  assert.match(morePage, /effective\.farmRole/);
});
