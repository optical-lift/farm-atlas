import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const schedule = read("supabase/migrations/20260812193000_rhythmic_work_live_schedule_correction_v1.sql");
const outreach = read("supabase/migrations/20260812194000_serial_outreach_conveyor_v1.sql");
const weed = read("supabase/migrations/20260812194500_weed_projection_and_clear_crop_merge_v1.sql");
const temporal = read("supabase/migrations/20260812195500_explicit_temporal_constraints_precede_generic_dayparts_v1.sql");
const hardCarry = read("supabase/migrations/20260812200500_hard_date_misses_do_not_silently_carry_v1.sql");
const choreography = read("supabase/migrations/20260812202500_choreography_placement_owns_execution_date_v1.sql");
const moveAssembly = read("lib/atlas/task-move-assembly.ts");
const ownerDay = read("components/atlas/owner-day-plan-gate.tsx");
const hardStopBanner = read("components/atlas/hard-stop-day-banner.tsx");
const hardStopApi = read("app/api/atlas/hard-stop-cue/route.ts");
const daySummary = read("components/atlas/day-trail-summary.tsx");

test("live schedule correction removes false work instead of rescheduling it", () => {
  assert.match(schedule, /zinnia_2026_s5_house_south_sow/);
  assert.match(schedule, /state='skipped'/);
  assert.match(schedule, /status='archived'/);
  assert.match(schedule, /not an approved sowing plan/i);
});

test("pressure washing and pot-up backlog move without forking task identities", () => {
  assert.match(schedule, /anna_20260811_gentle_pressure_wash_detached_garage_face/);
  assert.match(schedule, /2026-08-17/);
  assert.match(schedule, /anna_20260810_pot_up_200_cell_sweet_william_tray_1/);
  assert.match(schedule, /anna_20260811_pot_up_200_cell_shasta_daisy_tray_1/);
  assert.match(schedule, /anna_20260811_pot_up_200_cell_tetra_feverfew_oregano_tray_1/);
  assert.match(schedule, /2026-08-14/);
});

test("Home Depot is gated by external readiness rather than worker overdue state", () => {
  assert.match(schedule, /external_readiness_required/);
  assert.match(schedule, /external_readiness_state','waiting'/);
  assert.match(schedule, /Home Depot order is not ready for pickup yet/);
});

test("Thursday event constraints keep Corral mowing before guest time", () => {
  assert.match(schedule, /must_finish_before_local/);
  assert.match(schedule, /2026-08-13T17:45:00-05:00/);
  assert.match(schedule, /work_window_key','afternoon'/);
  assert.ok(temporal.indexOf("work_window_key") < temporal.indexOf("succession_sowing"), "explicit window must outrank generic sowing defaults");
});

test("Elm harvest remains the fixed Thursday rhythm even when this week executes Wednesday night", () => {
  assert.match(schedule, /recurring:anna_harvest_thursday_weekly:2026-08-13/);
  assert.match(schedule, /early_execution/);
  assert.match(schedule, /Event-specific Elm harvest copy replaced by the canonical weekly Thursday harvest rhythm/);
  assert.match(choreography, /due_date=date '2026-08-13'/);
  assert.match(choreography, /canonical_occurrence_date','2026-08-13'/);
  assert.match(choreography, /execution_date','2026-08-12'/);
  assert.match(choreography, /placement\.state='placed'/);
  assert.match(choreography, /choreography_owns_execution_date/);
});

test("finished bouquet holding uses fulfillment language and a real post-state", () => {
  assert.match(schedule, /Stage finished bouquets for pickup/);
  assert.match(schedule, /Fill florist buckets with 3” water/);
  assert.match(schedule, /Finished bouquets are held by guest name and ready for pickup/);
  assert.match(schedule, /operation_family','fulfill'/);
  assert.match(moveAssembly, /generic\.includes\(doneWhen\.toLowerCase\(\)\)/);
});

test("all calling work enters one serial outreach conveyor", () => {
  for (const label of [
    "Call · Florist buyers — batch 1",
    "Call · Free wood-chip sources",
    "Call · Restaurants — weekly bud vases",
    "Call · Church groups — Thursdays at Elm",
  ]) assert.match(outreach, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(outreach, /outreach_queue_key','anna_outreach_conveyor'/);
  assert.match(outreach, /Waiting for the previous outreach batch to be completed/);
  assert.match(outreach, /next_worker_day_v1/);
  assert.match(outreach, /released_for_next_worker_day/);
});

test("clear-crop work is a mode of the serial removal and weeding system", () => {
  assert.match(weed, /Clear crop · Field Row 9 beans/);
  assert.match(weed, /removal_mode','clear_crop'/);
  assert.match(weed, /work_collection_key','weeding'/);
  assert.match(weed, /anna_weeding_rotation/);
  assert.match(weed, /Duplicate MG11 continuation/);
});

test("Owner Day surfaces future Weed Cards as projections rather than released work", () => {
  assert.match(ownerDay, /automaticWork\?: AutomaticWorkRow\[\]/);
  assert.match(ownerDay, /sourceKind === "queue"/);
  assert.match(ownerDay, /conditional === true/);
  assert.match(ownerDay, /Projected Weed Card/);
  assert.match(ownerDay, /This is a projection, not another released task/);
});

test("hard-date sowing has an in-app Day cue independent of push delivery", () => {
  assert.match(daySummary, /<HardStopDayBanner dateIso=\{dayDateIso\}/);
  assert.match(hardStopBanner, /SOW TODAY|cue\.headline/);
  assert.match(hardStopApi, /This sowing owns today\. Open it before moving on\./);
  assert.match(hardStopApi, /OWNER DECISION NEEDED/);
  assert.match(hardStopApi, /Projected harvest shifts/);
  assert.match(hardStopApi, /missed && effectiveRole === "farm_hand"/);
});

test("missed hard dates become Owner exceptions instead of tomorrow's worker carry", () => {
  assert.match(hardCarry, /A missed hard calendar commitment becomes an exception for Owner review/);
  assert.match(hardCarry, /v_missed_hard_date_work/);
  assert.match(hardCarry, /owner_decision_required/);
  assert.match(hardCarry, /calendar_commitment_kind/);
});
