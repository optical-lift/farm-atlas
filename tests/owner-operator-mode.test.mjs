import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const context = read("lib/atlas/operator-context.ts");
const operatorHome = read("lib/atlas/operator-universal-home.ts");
const switcher = read("app/OwnerOperatorMode.tsx");
const selectionRoute = read("app/api/atlas/operator-context/route.ts");
const datedRoute = read("app/api/atlas/universal-task-cards/route.ts");
const taskRoute = read("app/api/atlas/task-cards/route.ts");
const transitionRoute = read("app/api/atlas/task-transition/route.ts");
const projectCreateRoute = read("app/api/atlas/projects/[projectId]/tasks/route.ts");
const portfolio = read("lib/atlas/portfolio.ts");
const layout = read("app/layout.tsx");
const farmMigration = read("supabase/migrations/20260729183500_atlas_owner_operator_mode_foundation.sql");
const accountMigration = read("supabase/migrations/20260729200356_atlas_owner_operator_dynamic_accounts_v1.sql");

test("owner operator mode keeps one authenticated owner session and a secure account cookie", () => {
  assert.match(context, /ATLAS_OPERATOR_COOKIE = "atlas_operator_account"/);
  assert.match(context, /LEGACY_ATLAS_OPERATOR_COOKIE = "atlas_operator_membership"/);
  assert.match(context, /owner_operator_accounts_v1/);
  assert.match(context, /organizationMemberships\.some\(\(membership\) => membership\.role === "owner"\)/);
  assert.match(selectionRoute, /httpOnly: true/);
  assert.match(selectionRoute, /sameSite: "lax"/);
  assert.match(selectionRoute, /context\.effective\.accountId/);
});

test("new active farm and organization accounts populate the operator selector automatically", () => {
  assert.match(accountMigration, /from atlas\.farm_memberships fm/);
  assert.match(accountMigration, /union\s+select om\.user_id[\s\S]*from atlas\.organization_memberships om/i);
  assert.match(accountMigration, /where fm\.active = true/);
  assert.match(accountMigration, /where om\.active = true/);
  assert.match(accountMigration, /'accountId', ar\.user_id/);
  assert.doesNotMatch(accountMigration, /Katie|Anna|Marshall/);
});

test("the owner can switch among every discovered Atlas account without changing routes", () => {
  assert.match(switcher, /Operating as/);
  assert.match(switcher, /option\.accountId/);
  assert.match(switcher, /window\.location\.reload\(\)/);
  assert.match(switcher, /Worker cues are safe previews/);
  assert.match(switcher, /Other task actions still change live Atlas data/);
  assert.match(layout, /<OwnerOperatorMode context=\{operatorContext\} \/>/);
  assert.match(layout, /owner-operator-mode\.css/);
});

test("farm and organization dashboards use the selected account scope", () => {
  assert.match(operatorHome, /owner_operator_universal_home_v1/);
  assert.match(operatorHome, /owner_operator_organization_home_v1/);
  assert.match(operatorHome, /effectiveOrganizationViewer/);
  assert.match(datedRoute, /effectiveOperatorAccountId\(operatorContext\)/);
  assert.match(datedRoute, /effectiveOperatorMembershipId\(operatorContext\)/);
  assert.match(taskRoute, /owner_operator_task_cards_v1/);
  assert.match(taskRoute, /effective\.farmRole/);
  assert.match(portfolio, /owner_operator_project_detail_v1/);
  assert.match(portfolio, /owner_operator_project_task_focus_v1/);
});

test("farm and project mutations preserve the real actor and selected account through one task endpoint", () => {
  assert.equal(existsSync(new URL("../app/api/atlas/project-tasks/[taskId]/transition/route.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app/api/atlas/owner/tasks/[taskId]/transition/route.ts", import.meta.url)), false);
  assert.match(transitionRoute, /owner_operator_record_task_transition_v1/);
  assert.match(transitionRoute, /owner_operator_reopen_task_completion_v1/);
  assert.match(transitionRoute, /owner_operator_transition_project_task_v1/);
  assert.match(transitionRoute, /effectiveOperatorAccountId/);
  assert.match(projectCreateRoute, /owner_operator_create_project_task_v1/);
  assert.match(farmMigration, /'operator_mode', true/);
  assert.match(farmMigration, /'actor_membership_id', v_actor_membership_id/);
  assert.match(farmMigration, /'effective_membership_id', v_effective_membership_id/);
  assert.match(accountMigration, /'effective_account_id', v_effective_user_id/);
});
