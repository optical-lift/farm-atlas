import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const security = readFileSync(new URL("../supabase/migrations/20260802123500_atlas_work_reservoir_security_boundary_v1.sql", import.meta.url), "utf8");
const contract = readFileSync(new URL("../supabase/migrations/20260802124000_atlas_presented_work_contract_v1.sql", import.meta.url), "utf8");
const readers = readFileSync(new URL("../supabase/migrations/20260802125000_atlas_presented_work_reader_cutover_v1.sql", import.meta.url), "utf8");
const reconciliation = readFileSync(new URL("../supabase/migrations/20260802130000_atlas_work_reservoir_backlog_reconciliation_v1.sql", import.meta.url), "utf8");
const preflight = readFileSync(new URL("../supabase/migrations/20260802131000_atlas_owner_tomorrow_preflight_v1.sql", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../supabase/migrations/20260802132000_atlas_presented_work_notification_cutover_v1.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/atlas/tomorrow-preflight/route.ts", import.meta.url), "utf8");
const livingDayRoute = readFileSync(new URL("../app/api/atlas/living-day/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/tomorrow/page.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("../components/atlas/tomorrow/TomorrowPreflight.tsx", import.meta.url), "utf8");

test("new reservoir helpers are not anonymously executable", () => {
  for (const functionName of [
    "work_effort_units_v1",
    "derive_work_lane_v1",
    "derive_commitment_kind_v1",
    "decorate_task_work_reservoir_v1",
    "member_day_load_core_v1",
    "member_day_load_v1",
    "object_work_context_v2",
    "create_object_work_v2",
    "work_occurrence_gate_satisfied_v1",
  ]) {
    assert.match(security, new RegExp(`revoke execute on function atlas\\.${functionName}`));
  }
  assert.match(security, /set search_path = pg_catalog, atlas/);
  assert.doesNotMatch(security, /grant execute on function atlas\.create_object_work_v2[\s\S]* to anon/);
});

test("Presented Work is one ordered execution contract", () => {
  assert.match(contract, /create or replace function atlas\.presented_work_rows_v1/);
  assert.match(contract, /when 'required' then 1/);
  assert.match(contract, /when 'process_continuation' then 2/);
  assert.match(contract, /when 'rhythm' then 3/);
  assert.match(contract, /greatest\(v_budget - m\.units, 0\)/);
  assert.match(contract, /held_for_day_budget/);
  assert.match(contract, /superseded_rhythm_serving/);
  assert.match(contract, /commitment_kind = 'hard_date'/);
  assert.match(contract, /task_notification_plans/);
});

test("daily readers consume Presented Work instead of raw open tasks", () => {
  assert.match(readers, /home_task_cards_for_membership_v2/);
  assert.match(readers, /worker_task_hand_v1/);
  assert.match(readers, /journal_day_for_membership_v1/);
  assert.ok((readers.match(/presented_work_rows_v1/g) ?? []).length >= 5);
  assert.match(livingDayRoute, /journal_day_for_membership_v1/);
  assert.match(livingDayRoute, /presentationContract: "presented_work_v1"/);
  assert.match(livingDayRoute, /plannedOpen: journal\.summary\.open/);
});

test("legacy backlog reconciliation is conservative and reversible", () => {
  assert.match(reconciliation, /create table if not exists atlas\.work_reservoir_decisions/);
  assert.match(reconciliation, /not exists \(select 1 from atlas\.task_transitions/);
  assert.match(reconciliation, /not exists \(select 1 from atlas\.task_outcome_events/);
  assert.match(reconciliation, /reservoirDecisionState', 'owner_review'/);
  assert.match(reconciliation, /resolve_work_reservoir_decision_v1/);
  for (const action of ["keep_now", "choose_date", "return_to_reservoir", "archive"]) {
    assert.match(reconciliation, new RegExp(action));
  }
  assert.match(reconciliation, /insert into atlas\.work_reservoir_retractions/);
});

test("Tomorrow Preflight reports people, overload, held work, and decisions", () => {
  assert.match(preflight, /owner_tomorrow_preflight_v1/);
  assert.match(preflight, /overloadedMemberCount/);
  assert.match(preflight, /hardDateMissingNotificationCount/);
  assert.match(preflight, /openDecisionCount/);
  assert.match(preflight, /atlas\.presented_work_v1/);
  assert.match(page, /TomorrowPreflight/);
  assert.match(surface, /The day Atlas will actually present/);
  assert.match(surface, /Held in the reservoir/);
  assert.match(surface, /Still real, choose a date, or let it go/);
});

test("management decisions require an explicit API intent", () => {
  assert.match(route, /tomorrow-preflight-decision-v1/);
  assert.match(route, /allowedRoles: \["owner", "manager"\]/);
  assert.match(route, /resolve_work_reservoir_decision_v1/);
  assert.match(route, /owner_tomorrow_preflight_v1/);
  assert.match(route, /choose_date/);
  assert.match(route, /return_to_reservoir/);
});

test("notification generation follows the same Presented Work selection", () => {
  assert.match(notifications, /ensure_task_notification_moments_v1/);
  assert.match(notifications, /dispatch_task_notification_moments_v1/);
  assert.ok((notifications.match(/presented_work_rows_v1/g) ?? []).length >= 2);
  assert.match(notifications, /presented_work_hard_date_backfill/);
  assert.match(notifications, /required_hard_date_notification_guarantee/);
  assert.match(notifications, /presentation_reason <> 'owner_review'/);
});
