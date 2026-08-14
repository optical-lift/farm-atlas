import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = read("supabase/migrations/20260814152000_owner_fixed_routine_commands_v1.sql");
const sourceMigration = read("supabase/migrations/20260814133500_owner_day_reservation_commands_v1.sql");
const hardening = read("supabase/migrations/20260814141500_fixed_routine_projection_hardening_v1.sql");
const route = read("app/api/atlas/owner-fixed-routine/route.ts");
const client = read("lib/atlas/fixed-routine-client.ts");
const manager = read("components/atlas/reservations/FixedRoutineManager.tsx");
const occurrenceEditor = read("components/atlas/reservations/ReservationEditor.tsx");
const day = read("components/atlas/reservations/DayFixedTimes.tsx");
const clock = read("components/atlas/clock/clock-timeline-v2.tsx");
const planningClock = read("components/atlas/clock/clock-planning-timeline.tsx");

test("Pass 28 gives fixed routines one Owner-authoritative command boundary", () => {
  assert.match(migration, /owner_command_fixed_routine_api_v1/);
  assert.match(migration, /v_operation not in \('create','change','end','resume'\)/);
  assert.match(migration, /security definer/i);
  assert.match(migration, /fm\.role = 'owner'/);
  assert.match(migration, /fm\.role = 'farm_hand'/);
  assert.match(route, /owner_command_fixed_routine_api_v1/);
  assert.match(route, /x-atlas-intent/);
  assert.match(route, /owner-fixed-routine-v1/);
  assert.doesNotMatch(route, /\.from\("fixed_routines"\)\.(insert|update|delete)/);
});

test("fixed routine writes stay closed and the new authenticated RPC is registered", () => {
  assert.match(migration, /revoke insert, update, delete on atlas\.fixed_routines from authenticated/i);
  assert.match(migration, /atlas\.authenticated_rpc_registry/);
  assert.match(migration, /owner_admin_endpoint/);
  assert.match(migration, /verified/);
  assert.match(migration, /taskTruth/);
});

test("routine source remains a reservation source and never becomes recurring task truth", () => {
  assert.match(sourceMigration, /fixed_routines/);
  assert.match(sourceMigration, /insert into atlas\.day_reservations/);
  assert.match(hardening, /source = 'fixed_routine'/);
  assert.match(hardening, /source_reference/);
  assert.doesNotMatch(migration, /insert into atlas\.tasks|update atlas\.tasks|delete from atlas\.tasks/i);
  assert.doesNotMatch(manager, /Done|Reopen|Task Focus|dependency/i);
});

test("source mutations reconcile Worker Days only after the canonical server commit", () => {
  assert.match(client, /commitAtlasFixedRoutineCommand/);
  assert.match(client, /dispatchAtlasWorkerDayRuntimeInvalidation\(\)/);
  const responseCheck = client.indexOf("if (!response.ok || result.ok !== true)");
  const invalidation = client.indexOf("dispatchAtlasWorkerDayRuntimeInvalidation();");
  assert.ok(responseCheck >= 0 && invalidation > responseCheck);
  assert.doesNotMatch(client, /optimistic.*reservation/i);
});

test("Pass 29 exposes a phone-sized Owner routine manager on Day and both Clock modes", () => {
  assert.match(manager, /data-fixed-routine-manager="true"/);
  assert.match(manager, /Repeating fixed times/);
  assert.match(manager, /This defines dated reservations\. It does not create recurring tasks\./);
  assert.match(manager, /Repeats on/);
  assert.match(manager, /Starts applying/);
  assert.match(manager, /Final date/);
  assert.match(day, /FixedRoutineManager/);
  assert.match(clock, /FixedRoutineManager/);
  assert.match(planningClock, /FixedRoutineManager/);
  assert.match(clock, />Routines</);
  assert.match(planningClock, />Routines</);
});

test("a generated occurrence can edit itself or explicitly open its source routine", () => {
  assert.match(occurrenceEditor, /editing this occurrence only/);
  assert.match(occurrenceEditor, /Remove occurrence/);
  assert.match(occurrenceEditor, /Edit repeating routine/);
  assert.match(occurrenceEditor, /focusRoutineId=\{generatedRoutine\}/);
  assert.match(occurrenceEditor, /source === "fixed_routine"/);
});

test("ending a routine preserves the source and history instead of hard deleting it", () => {
  assert.match(migration, /v_operation = 'end'/);
  assert.match(migration, /set effective_through = v_effective_through/);
  assert.match(migration, /active = true/);
  assert.doesNotMatch(migration, /delete from atlas\.fixed_routines/i);
  assert.match(manager, /End after/);
  assert.match(manager, /Resume routine/);
});

test("weekday recurrence is explicit and constrained to real Sunday through Saturday values", () => {
  assert.match(migration, /array\[0,1,2,3,4,5,6\]::smallint\[\]/);
  assert.match(hardening, /fixed_routines_weekdays_check/);
  for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
    assert.ok(manager.includes(day));
  }
});
