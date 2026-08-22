import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundleMigration = await readFile(new URL("../supabase/migrations/20260822153500_worker_self_live_bundle_fast_card_shell_v1.sql", import.meta.url), "utf8");
const liveSelector = await readFile(new URL("../supabase/migrations/20260822154500_worker_live_presented_selector_v1.sql", import.meta.url), "utf8");
const feedCutover = await readFile(new URL("../supabase/migrations/20260822155500_worker_day_feed_live_selector_cutover_v2.sql", import.meta.url), "utf8");
const reservationsMigration = await readFile(new URL("../supabase/migrations/20260822161200_day_reservations_read_bundle_v2.sql", import.meta.url), "utf8");
const executeScopeMigration = await readFile(new URL("../supabase/migrations/20260822174152_worker_fast_path_execute_scope_v1.sql", import.meta.url), "utf8");
const workerSelfServer = await readFile(new URL("../lib/atlas/worker-self-day-plan-server.ts", import.meta.url), "utf8");
const reservationsServer = await readFile(new URL("../lib/atlas/day-reservations-server.ts", import.meta.url), "utf8");

test("today's worker bundle stays on the live selector and cheap collapsed card shell", () => {
  assert.match(bundleMigration, /if p_day = v_today then[\s\S]*worker_day_feed_plan_live_v1/);
  assert.match(bundleMigration, /if p_day = v_today then[\s\S]*worker_day_operational_task_cards_v2/);
  assert.match(bundleMigration, /else[\s\S]*worker_day_operational_task_cards_v3/);
  assert.match(bundleMigration, /'nextUp', '\[\]'::jsonb/);
  assert.match(bundleMigration, /'clockTimeline', jsonb_build_object\('items', '\[\]'::jsonb\)/);
});

test("live feed selection does not rebuild the full Reality candidate packet", () => {
  assert.match(liveSelector, /presented_work_selection_rows_legacy_v1/);
  assert.doesNotMatch(liveSelector, /farm_clock_reality_candidates_v1/);
  assert.match(feedCutover, /presented_work_selection_rows_live_v1/);
  assert.doesNotMatch(feedCutover, /presented_work_selection_rows_v3\(/);
  assert.match(feedCutover, /'selectionContractVersion', 'presented_work_selection_rows_live_v1'/);
});

test("farm-hand first paint does not re-query task timing after the bundle returns", () => {
  assert.match(workerSelfServer, /normalizeWorkerSelfPlan\(payload\.plan, false\)/);
  assert.match(workerSelfServer, /if \(!enrichTiming\) return \{ \.\.\.normalized, suggestions: \[\] \}/);
});

test("reservation reconciliation is one read RPC with a no-routine fast path", () => {
  assert.match(reservationsServer, /rpc\("day_reservations_api_v2"/);
  assert.doesNotMatch(reservationsServer, /sync_fixed_routine_reservations_for_day_v1/);
  assert.match(reservationsMigration, /if exists\([\s\S]*from atlas\.fixed_routines/);
  assert.match(reservationsMigration, /or exists\([\s\S]*from atlas\.day_reservations/);
  assert.match(reservationsMigration, /perform atlas\.sync_fixed_routine_reservations_for_day_v1/);
});

test("internal fast-path helpers cannot become direct client RPC surfaces", () => {
  for (const helper of ["presented_work_selection_rows_live_v1", "worker_day_feed_plan_live_v1"]) {
    const signature = `${helper}\\(uuid, uuid, date\\)`;
    assert.match(executeScopeMigration, new RegExp(`revoke all on function atlas\\.${signature} from public`, "i"));
    assert.match(executeScopeMigration, new RegExp(`revoke all on function atlas\\.${signature} from anon`, "i"));
    assert.match(executeScopeMigration, new RegExp(`revoke all on function atlas\\.${signature} from authenticated`, "i"));
  }
  for (const api of ["day_reservations_api_v2", "worker_day_choreography_bundle_api_v2"]) {
    const signature = `${api}\\(uuid, uuid, date\\)`;
    assert.match(executeScopeMigration, new RegExp(`revoke all on function atlas\\.${signature} from public`, "i"));
    assert.match(executeScopeMigration, new RegExp(`revoke all on function atlas\\.${signature} from anon`, "i"));
    assert.match(executeScopeMigration, new RegExp(`grant execute on function atlas\\.${signature} to authenticated`, "i"));
  }
});
