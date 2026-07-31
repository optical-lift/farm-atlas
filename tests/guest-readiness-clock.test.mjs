import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260731150000_guest_readiness_clock_v1.sql");
const satisfactionPatch = read("supabase/migrations/20260731150100_guest_readiness_satisfaction_kind_fix_v1.sql");
const boundaryPatch = read("supabase/migrations/20260731150200_guest_readiness_recovery_boundary_fix_v1.sql");
const recoveryPatch = read("supabase/migrations/20260731150300_guest_readiness_recovery_state_fix_v1.sql");
const titlePatch = read("supabase/migrations/20260731150400_guest_readiness_initial_acceptance_title_v1.sql");
const route = read("app/api/atlas/guest-readiness/route.ts");
const focusRoute = read("app/task-focus/[taskId]/page.tsx");
const focusPage = read("app/task-focus/[taskId]/GuestReadinessFocusPage.tsx");
const focusStyles = read("app/task-focus/[taskId]/HarvestFocus.module.css");
const rhythmManager = read("app/manage/rhythms/BiologicalRhythmManager.tsx");
const rhythmPage = read("app/manage/rhythms/page.tsx");

const roomKeys = [
  "venue_entry",
  "venue_bathroom",
  "venue_kitchen",
  "venue_lounge",
  "venue_library",
  "venue_conference_room",
  "venue_studio",
];

const outcomes = [
  "ready",
  "small_reset_needed",
  "not_guest_ready",
  "event_damage_or_problem",
  "closed_not_in_use",
];

test("Guest Readiness keeps append-only rounds and room evidence separate from current state", () => {
  assert.match(migration, /create table if not exists atlas\.guest_readiness_rounds/);
  assert.match(migration, /create table if not exists atlas\.guest_readiness_events/);
  assert.match(migration, /create table if not exists atlas\.guest_readiness_room_state/);
  assert.match(migration, /Guest readiness history is append-only/);
  assert.match(migration, /before update or delete on atlas\.guest_readiness_rounds/);
  assert.match(migration, /before update or delete on atlas\.guest_readiness_events/);
});

test("one venue Clock governs one calm round while seven rooms retain physical state", () => {
  assert.match(migration, /rhythm_key[^\n]*'guest_readiness'/);
  assert.match(migration, /subject_kind[^\n]*'zone'/);
  assert.match(migration, /'zone_modifier','zone'/);
  for (const roomKey of roomKeys) assert.match(migration, new RegExp(roomKey));
  assert.match(migration, /guest_readiness_room_count',7/);
  assert.match(migration, /roomCount',7/);
});

test("time opens a room walk but never claims a venue is ready or dirty", () => {
  assert.match(migration, /timeClaimsPhysicalCondition',false/);
  assert.match(migration, /physicalCondition','unknown/);
  assert.match(migration, /Time opened the walk; it did not decide the result/);
  assert.match(focusPage, /Time does not claim a room is dirty/);
  assert.match(focusPage, /What is physically true\?/);
});

test("every room result uses the specialized readiness grammar", () => {
  for (const outcome of outcomes) {
    assert.match(migration, new RegExp(outcome));
    assert.match(route, new RegExp(outcome));
    assert.match(focusPage, new RegExp(outcome));
  }
  assert.match(migration, /Record one result for each of the % guest rooms/);
  assert.match(focusPage, /Choose a result for all/);
});

test("only a fully ready active venue renews the Clock", () => {
  assert.match(migration, /v_aggregate='ready'/);
  assert.match(migration, /'full',v_now,v_rule\.validity_interval_seconds/);
  assert.match(migration, /guest_readiness_round_ready_v1/);
  assert.match(migration, /evaluate_rhythm_binding_v1\(v_state\.id,v_now,'guest_readiness_result'\)/);
  assert.match(satisfactionPatch, /full_renewal/);
  assert.match(satisfactionPatch, /'''full'''/);
});

test("small resets remain the same open recovering round", () => {
  assert.match(migration, /v_aggregate='small_reset_needed'/);
  assert.match(migration, /record_task_transition_v1_internal\(v_task\.id,'partial'/);
  assert.match(migration, /state='recovering'/);
  assert.match(migration, /'partial_result'/);
  assert.match(boundaryPatch, /partial_result/);
  assert.match(recoveryPatch, /restore recovering state after the canonical task transition/);
  assert.match(focusPage, /This round stays open until the small resets are finished/);
});

test("serious readiness problems become Owner-visible blockers without inventing repair facts", () => {
  assert.match(migration, /record_task_transition_v1_internal\(v_task\.id,'blocked'/);
  assert.match(migration, /guest_readiness_owner_handoff/);
  assert.match(migration, /assigned_membership_id=v_owner_membership_id/);
  assert.match(migration, /event_damage_or_problem/);
  assert.match(focusPage, /returns it to the Owner/);
});

test("only an Owner or manager may close a room or pause the venue rhythm", () => {
  assert.match(migration, /Only the Owner or manager may close a venue room/);
  assert.match(migration, /v_role not in \('owner','manager'\)/);
  assert.match(migration, /update atlas\.rhythm_bindings set active=false/);
  assert.match(focusRoute, /role === "owner" \|\| role === "manager"/);
  assert.match(focusPage, /task\.canCloseRooms/);
});

test("the existing final-clean task is adopted instead of duplicated", () => {
  assert.match(migration, /owner_20260808_final_clean_photos_acceptance/);
  assert.match(migration, /initial_guest_readiness_acceptance/);
  assert.match(migration, /Final clean, photograph \+ Guest Readiness acceptance/);
  assert.match(migration, /photograph_accepted_state/);
  assert.match(titlePatch, /Final clean, photograph \+ Guest Readiness acceptance/);
  assert.match(titlePatch, /planned_work_occurrences/);
});

test("Guest Readiness writes remain authenticated same-origin operations", () => {
  assert.match(route, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /owner_operator_record_guest_readiness_round_v1/);
  assert.match(route, /record_guest_readiness_round_for_member_v1/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);
});

test("Guest Readiness uses the universal task-focus route and mobile room cards", () => {
  assert.match(focusRoute, /isGuestReadinessTask/);
  assert.match(focusRoute, /GuestReadinessFocusPage/);
  assert.match(focusRoute, /guest_readiness_room_state/);
  assert.match(focusPage, /Walk every room and record its real condition/);
  assert.match(focusStyles, /\.roomList/);
  assert.match(focusStyles, /\.roomCard/);
  assert.match(focusStyles, /@media \(max-width: 390px\)/);
});

test("the Owner Rulebook includes Guest Readiness as a farm rhythm", () => {
  assert.match(migration, /'guest_readiness'\)/);
  assert.match(rhythmManager, /Guest readiness/);
  assert.match(rhythmManager, /indoor venue’s Guest Readiness rule/);
  assert.match(rhythmPage, /<h1>Farm rhythms<\/h1>/);
  assert.match(rhythmPage, /care, observation, and readiness work/);
});
