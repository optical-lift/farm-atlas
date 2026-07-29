import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const layout = read("app/layout.tsx");
const migration = read("supabase/migrations/20260729183500_atlas_owner_operator_mode_foundation.sql");

test("owner operator mode keeps one authenticated owner session and a secure account cookie", () => {
  assert.match(context, /ATLAS_OPERATOR_COOKIE = "atlas_operator_account"/);
  assert.match(context, /LEGACY_ATLAS_OPERATOR_COOKIE = "atlas_operator_membership"/);
  assert.match(context, /owner_operator_accounts_v1/);
  assert.match(context, /session\?\.memberships\.some\(\(membership\) => membership\.role === "owner"\)/);
  assert.match(context, /session\?\.organizationMemberships\.some\(\(membership\) => membership\.role === "owner"\)/);
  assert.match(selectionRoute, /accountId/);
  assert.match(selectionRoute, /httpOnly: true/);
  assert.match(selectionRoute, /sameSite: "lax"/);
  assert.match(selectionRoute, /context\.effective\.accountId/);
});

test("the owner can switch among live Atlas accounts without changing routes", () => {
  assert.match(switcher, /Operating as/);
  assert.match(switcher, /selectAccount/);
  assert.match(switcher, /activeContext\.effective\.accountId/);
  assert.match(switcher, /window\.location\.reload\(\)/);
  assert.match(switcher, /Actions change live Atlas data/);
  assert.match(layout, /<OwnerOperatorMode context=\{operatorContext\} \/>/);
  assert.match(layout, /owner-operator-mode\.css/);
});

test("Home and dated task readers use the effective account and farm membership when available", () => {
  assert.match(operatorHome, /effectiveAccountId/);
  assert.match(operatorHome, /owner_operator_universal_home_v1/);
  assert.match(operatorHome, /owner_operator_organization_home_v1/);
  assert.match(operatorHome, /organizationMemberships/);
  assert.match(operatorHome, /canManageAnyPortfolio: role === "owner"/);
  assert.match(datedRoute, /effectiveOperatorAccountId\(operatorContext\)/);
  assert.match(datedRoute, /effectiveOperatorMembershipId\(operatorContext\)/);
  assert.match(taskRoute, /owner_operator_task_cards_v1/);
  assert.match(taskRoute, /effective\.farmRole \?\? operatorContext\?\.effective\.role/);
});

test("operator mutations change live task data while preserving actor and effective identities", () => {
  assert.match(transitionRoute, /owner_operator_record_task_transition_v1/);
  assert.match(transitionRoute, /owner_operator_reopen_task_completion_v1/);
  assert.match(migration, /'operator_mode', true/);
  assert.match(migration, /'actor_membership_id', v_actor_membership_id/);
  assert.match(migration, /'effective_membership_id', v_effective_membership_id/);
  assert.match(migration, /target_membership\.farm_id = owner_membership\.farm_id/);
  assert.match(migration, /owner_membership\.role = 'owner'/);
});
