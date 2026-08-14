import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = read("supabase/migrations/20260814133500_owner_day_reservation_commands_v1.sql");
const hardeningMigration = read("supabase/migrations/20260814141500_fixed_routine_projection_hardening_v1.sql");
const route = read("app/api/atlas/owner-day-reservation/route.ts");
const commandClient = read("lib/atlas/reservation-command-client.ts");
const runtime = read("components/atlas/runtime/AtlasRuntimeProvider.tsx");
const reconciliation = read("lib/atlas/runtime-reconciliation.ts");
const reservationContract = read("lib/atlas/day-reservations.ts");
const reservationServer = read("lib/atlas/day-reservations-server.ts");
const clockBlock = read("components/atlas/clock/ClockReservationBlock.tsx");
const clockTimeline = read("components/atlas/clock/clock-timeline-v2.tsx");
const planningTimeline = read("components/atlas/clock/clock-planning-timeline.tsx");
const dayStrip = read("components/atlas/reservations/DayFixedTimes.tsx");
const editor = read("components/atlas/reservations/ReservationEditor.tsx");
const planDraft = read("lib/atlas/clock-plan-draft.ts");
const proposal = read("lib/atlas/clock-proposal.ts");

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

test("Pass 21 uses one server-authoritative reservation command family", () => {
  assert.match(migration, /owner_command_day_reservation_api_v1/);
  for (const operation of ["create", "change", "move", "resize", "remove"]) assert.match(migration, new RegExp(`'${operation}'`));
  assert.match(route, /owner_command_day_reservation_api_v1/);
  assert.match(route, /x-atlas-intent/);
  assert.match(route, /resolveOwnerWorkerDayPlanningTarget/);
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(commandClient, /\/api\/atlas\/owner-day-reservation/);
  assert.match(migration, /revoke insert, update, delete on atlas\.day_reservations from authenticated/);
  assert.doesNotMatch(route, /\.from\("day_reservations"\).*\.(insert|update|delete)/s);
});

test("Pass 22 reservation actions share AtlasRuntime reconciliation without fabricating projection revisions", () => {
  assert.match(runtime, /dispatchReservationCommand/);
  assert.match(runtime, /kind: "reservation_command"/);
  assert.match(runtime, /pendingActions\.filter\(\(pending\) => pending\.actionId !== actionId\)/);
  assert.match(runtime, /phase: "reconciling"/);
  assert.match(runtime, /readWorkerDay\(command\.serviceDate, \{ force: true \}\)/);
  assert.match(reconciliation, /reservationOverlay/);
  assert.match(reconciliation, /reservations,/);
  assert.match(reconciliation, /canonical revision belongs to the server projection/);
  assert.doesNotMatch(reconciliation, /revision\s*:/);
});

test("Pass 23 keeps editable Clock reservations outside task semantics", () => {
  assert.match(clockBlock, /data-clock-non-task="true"/);
  assert.match(clockBlock, /reservation_move/);
  assert.match(clockBlock, /reservation_resize/);
  assert.match(clockTimeline, /tap-open-space/);
  assert.match(clockTimeline, /ReservationEditor/);
  assert.doesNotMatch(clockBlock, /task-focus|Done|Reopen|dependency/i);
  assert.doesNotMatch(editor, /task-focus|Done|Reopen|dependency/i);
});

test("Pass 24 Day fixed times are informational for Farm Hand and editable only for Owner", () => {
  assert.match(dayStrip, /Today’s fixed times/);
  assert.match(dayStrip, /data-day-fixed-time-informational="true"/);
  assert.match(dayStrip, /canManage \?/);
  assert.match(dayStrip, /ReservationEditor/);
  assert.doesNotMatch(dayStrip, /task-focus|Mark complete|Reopen/i);
});

test("Pass 25 proposals reflow pending blocks and stay reservation-editable while the proposal is open", () => {
  assert.match(planDraft, /reconcileAtlasClockPlanDraftWithProposal/);
  assert.match(planDraft, /current\.decision === "accept" \|\| current\.decision === "reject"/);
  assert.match(planDraft, /code:"reservation"/);
  assert.match(proposal, /atlasClockReservationConflicts/);
  assert.match(proposal, /firstFree/);
  assert.match(planningTimeline, /ClockReservationBlock/);
  assert.match(planningTimeline, /tap-open-space/);
  assert.match(planningTimeline, /ReservationEditor/);
});

test("acceptance specimen: exact reservation boundaries are legal but crossing the pickup is not", () => {
  const pickupStart = 15 * 60;
  const pickupEnd = 16 * 60;
  assert.equal(overlaps(14 * 60, pickupStart, pickupStart, pickupEnd), false, "work may end exactly at 3:00");
  assert.equal(overlaps(pickupEnd, 17 * 60, pickupStart, pickupEnd), false, "work may begin exactly at 4:00");
  assert.equal(overlaps(14 * 60 + 30, pickupEnd, pickupStart, pickupEnd), true, "2:30–4:00 crosses the pickup");
});

test("Pass 26 fixed routines project dated reservations instead of recurring tasks", () => {
  assert.match(migration, /create table if not exists atlas\.fixed_routines/);
  assert.match(migration, /sync_fixed_routine_reservations_for_day_v1/);
  assert.match(migration, /insert into atlas\.day_reservations/);
  assert.match(reservationServer, /sync_fixed_routine_reservations_for_day_v1/);
  assert.doesNotMatch(migration, /insert into atlas\.tasks/);
  assert.match(hardeningMigration, /weekdays/);
});

test("Pass 27 records provenance and occurrence-level generated reservation behavior", () => {
  assert.match(reservationContract, /owner_manual.*fixed_routine.*calendar_import.*atlas_rule/);
  assert.match(reservationContract, /sourceReference/);
  assert.match(migration, /source_reference/);
  assert.match(migration, /occurrenceOverride/);
  assert.match(migration, /suppressed/);
  assert.match(editor, /editing this occurrence only/);
  assert.match(editor, /Remove occurrence/);
  assert.match(hardeningMigration, /occurrence_override/);
});

test("hard reservation boundaries preserve real-day geometry without becoming absence or cue truth", () => {
  assert.match(migration, /day_reservations/);
  assert.doesNotMatch(migration, /alter table atlas\.member_unavailability/);
  assert.doesNotMatch(migration, /alter table atlas\.worker_day_cues/);
  assert.doesNotMatch(reservationContract, /taskId|task_id|due_date|status/);
});
