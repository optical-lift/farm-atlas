import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPath = "supabase/migrations/20260731214500_atlas_owner_operator_exact_portal_parity_v1.sql";

test("ordinary and switched Home task cards use one effective-membership reader", () => {
  const migration = read(migrationPath);

  assert.match(migration, /create or replace function atlas\.home_task_cards_for_membership_v2/i);
  assert.match(
    migration,
    /create or replace function atlas\.home_task_cards_v2[\s\S]*home_task_cards_for_membership_v2/i,
  );
  assert.match(
    migration,
    /create or replace function atlas\.owner_operator_home_task_cards_v1[\s\S]*home_task_cards_for_membership_v2/i,
  );
  assert.doesNotMatch(
    migration.match(/create or replace function atlas\.owner_operator_home_task_cards_v1[\s\S]*?\$function\$;/i)?.[0] ?? "",
    /visibility_scope\s*=/i,
  );
  assert.match(migration, /card\.task_type = 'grow_room_care'/);
  assert.match(migration, /coalesce\(card\.zone_key, ''\) = 'grow_room'/);
});

test("membership-targeted helpers remain internal and owner wrappers are registry governed", () => {
  const migration = read(migrationPath);

  for (const signature of [
    "home_task_cards_for_membership_v2(uuid, uuid, date, date)",
    "can_read_task_for_membership_v1(uuid, uuid)",
    "home_day_for_membership_v1(uuid, date)",
    "task_day_dispositions_for_membership_v1(uuid, date)",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function atlas\\.${signature.replace(/[()]/g, "\\$&")}[\\s\\S]*from public, anon, authenticated`, "i"),
    );
  }

  assert.match(migration, /atlas\.owner_operator_home_day_v1\(uuid, date\)/);
  assert.match(migration, /atlas\.owner_operator_task_day_dispositions_v1\(uuid, date\)/);
  assert.match(migration, /insert into atlas\.authenticated_rpc_registry/i);
  assert.match(migration, /authenticated_rpc_registry_drift_v1/);
  assert.doesNotMatch(migration, /21436a28|23e98e5e|6a503d9f|4cd799e2/i);
});

test("switched farm-hand Home uses the effective Living Day instead of the Owner journal", () => {
  const page = read("app/page.tsx");
  const reader = read("lib/atlas/switched-account-home-overview.ts");

  assert.match(page, /operatorContext\?\.isOperating[\s\S]*operatorContext\.effective\.farmRole === "farm_hand"/);
  assert.match(page, /readAtlasSwitchedFarmHandHomeOverview/);
  assert.match(reader, /owner_operator_home_day_v1/);
  assert.match(reader, /p_effective_membership_id: effectiveMembershipId/);
  assert.doesNotMatch(reader, /rpc\("living_day_v1"/);
});

test("Home and dated task routes read set-asides from the selected account", () => {
  const dispositionReader = read("lib/atlas/task-day-dispositions-server.ts");
  const datedRoute = read("app/api/atlas/universal-task-cards/route.ts");

  assert.match(dispositionReader, /effectiveOperatorMembershipId/);
  assert.match(dispositionReader, /owner_operator_task_day_dispositions_v1/);
  assert.match(dispositionReader, /viewer_task_day_dispositions_v1/);
  assert.match(datedRoute, /readAtlasTaskDayDispositions\(doneDate\)/);
  assert.doesNotMatch(datedRoute, /rpc\("viewer_task_day_dispositions_v1"/);
});
