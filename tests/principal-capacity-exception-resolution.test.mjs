import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../app/api/atlas/principal/worker-day-shape/route.ts", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../app/principal/resolve/farm-capacity/page.tsx", import.meta.url),
  "utf8",
);
const client = readFileSync(
  new URL("../app/principal/resolve/farm-capacity/WorkerDayShapeResolutionClient.tsx", import.meta.url),
  "utf8",
);
const resyncMigration = readFileSync(
  new URL("../supabase/migrations/20260817022000_worker_day_shape_principal_capacity_resync_v1.sql", import.meta.url),
  "utf8",
);
const titleMigration = readFileSync(
  new URL("../supabase/migrations/20260817022500_principal_escalation_human_title_v1.sql", import.meta.url),
  "utf8",
);

test("Principal Farm Hand capacity resolution stays on the authenticated owner contract", () => {
  assert.match(route, /principal_owner_required/);
  assert.match(route, /owner_set_worker_day_shape_api_v1/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);
  assert.match(route, /worker_day_shape_reason_required/);
});

test("capacity exception workspace is driven by admitted Farm Clock escalation metadata", () => {
  assert.match(page, /source_type !== "operational_escalation"/);
  assert.match(page, /sourceSystem/);
  assert.match(page, /farm_clock/);
  assert.match(page, /worker_weekly_capacity/);
  assert.match(page, /ordinary delegated work remains contained/i);
});

test("Day Shape form invents no working days or hours", () => {
  assert.match(client, /useState<number\[]>\(\[\]\)/);
  assert.match(client, /useState\(""\)/);
  assert.match(client, /Choose only the days this Farm Hand is actually available/);
  assert.match(client, /Do not choose hours that make the work fit|Record the human truth Atlas should remember/);
});

test("current Day Shape authoring immediately re-evaluates the Principal exception", () => {
  assert.match(resyncMigration, /sync_worker_weekly_capacity_escalation_v1/);
  assert.match(resyncMigration, /p_effective_from<=v_today/);
  assert.match(resyncMigration, /capacitySync/);
  assert.doesNotMatch(resyncMigration, /grant execute[\s\S]{0,160}authenticated/i);
});

test("Principal escalation headlines are readable without losing machine kind", () => {
  assert.match(titleMigration, /initcap\(replace\(e\.escalation_kind/);
  assert.match(titleMigration, /refusing blind rewrite/);
  assert.doesNotMatch(titleMigration, /drop view/i);
});
