import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const personalMigration = readFileSync(
  new URL("../supabase/migrations/20260804053500_atlas_strict_personal_work_scope_v1.sql", import.meta.url),
  "utf8",
);
const managementMigration = readFileSync(
  new URL("../supabase/migrations/20260804052000_atlas_personal_work_and_manager_big_picture_v1.sql", import.meta.url),
  "utf8",
);
const workAlongsideRoute = readFileSync(
  new URL("../app/api/atlas/work-alongside/route.ts", import.meta.url),
  "utf8",
);
const workAlongsideOverlay = readFileSync(
  new URL("../components/atlas/work-alongside/AtlasWorkAlongsideOverlay.tsx", import.meta.url),
  "utf8",
);
const morePage = readFileSync(new URL("../app/more/page.tsx", import.meta.url), "utf8");
const farmDayPage = readFileSync(new URL("../app/manage/day/page.tsx", import.meta.url), "utf8");

test("normal Work is membership-personal and cross-person work requires an explicit window", () => {
  assert.match(personalMigration, /assigned_membership_id = p_membership_id/);
  assert.match(personalMigration, /assigned_user_id = v_user_id/);
  assert.match(personalMigration, /work_alongside_windows/);
  assert.doesNotMatch(personalMigration, /shared_with_membership_ids/);
  assert.doesNotMatch(
    managementMigration.match(/CREATE OR REPLACE FUNCTION atlas\.home_task_cards_v2[\s\S]*?\$function\$;/)?.[0] ?? "",
    /cross join lateral atlas\.home_task_cards_for_membership_v2/i,
  );
});

test("Owner and Manager can configure work-alongside without changing task ownership", () => {
  assert.match(workAlongsideRoute, /role === "owner" \|\| role === "manager"/);
  assert.match(workAlongsideRoute, /Farm management membership required/);
  assert.match(workAlongsideRoute, /observer_membership_id/);
  assert.match(workAlongsideRoute, /teammate_membership_id/);
  assert.doesNotMatch(workAlongsideRoute, /assigned_membership_id/);
});

test("management gets a separate farm-wide day instead of broadening My work", () => {
  assert.match(managementMigration, /farm_day_task_cards_v1/);
  assert.match(managementMigration, /v_role NOT IN \('owner', 'manager'\)/);
  assert.match(morePage, /canManage \? <div id="atlas-more-work-alongside-slot"/);
  assert.match(morePage, /href: "\/manage\/day"/);
  assert.match(farmDayPage, /requireAtlasRole\(\["owner", "manager"\]\)/);
  assert.match(farmDayPage, /farm_day_task_cards_v1/);
  assert.match(farmDayPage, />My work</);
  assert.match(farmDayPage, />Big picture</);
  assert.match(workAlongsideOverlay, /atlas-day-management-lens-tabs/);
  assert.match(workAlongsideOverlay, />My work</);
  assert.match(workAlongsideOverlay, />Big picture</);
  assert.match(workAlongsideOverlay, /\/manage\/day\?date=/);
});