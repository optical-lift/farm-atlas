import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const cue = read("app/day/DayCueDelivery.tsx");
const brief = read("components/atlas/task-execution-brief.tsx");
const spine = read("components/atlas/task-move-spine.tsx");
const shell = read("components/atlas/assigned-task-execution-shell.tsx");
const children = read("components/atlas/stateful-child-checklist.tsx");
const route = read("app/api/atlas/universal-task-cards/route.ts");
const contractMigration = read("supabase/migrations/20260813002500_worker_surface_grammar_contract_v1.sql");
const liveMigration = read("supabase/migrations/20260813003000_elm_worker_surface_live_normalization_v1.sql");

test("worker cues can be set aside without acknowledging them or trapping Atlas", () => {
  assert.match(cue, /hideCueForSession/);
  assert.match(cue, /aria-label="Close cue for now"/);
  assert.match(cue, /pointerEvents: "none"/);
  assert.match(cue, /maxHeight: "min\(62vh, 520px\)"/);
  assert.match(cue, /overflowY: "auto"/);
});

test("Task Focus keeps result controls but removes explanatory Done and hidden Instructions grammar", () => {
  assert.match(shell, /TaskPrimaryResultControls/);
  assert.match(shell, /Partly done/);
  assert.match(shell, /Problem found/);
  assert.doesNotMatch(brief, /<summary>Instructions<\/summary>/);
  assert.doesNotMatch(spine, /step-label">Done/);
  assert.match(spine, /requirementSection/);
  assert.match(spine, /Mowing next/);
});

test("grouped sowing children can record one real bed without attesting the sibling", () => {
  assert.match(children, /planting_log_auto_capture/);
  assert.match(children, /plantedObjectId/);
  assert.match(shell, /openStatefulChildren/);
  assert.match(shell, /StatefulChildChecklist/);
  assert.match(liveMigration, /owner_20260808_sow_procut_horizon_bw7/);
  assert.match(liveMigration, /owner_20260808_sow_procut_horizon_bw8/);
  assert.match(liveMigration, /planting_log_default_object_id/);
  assert.match(liveMigration, /planting_method','direct_sow'/);
});

test("Snow in Summer and station work use the corrected physical objects", () => {
  assert.match(liveMigration, /quantity_needed=4/);
  assert.match(liveMigration, /pot_up_tray_200_cell/);
  assert.match(liveMigration, /delete from atlas\.task_resource_requirements[\s\S]*pot_up_tray_120_cell/);
  assert.match(liveMigration, /Venue Lighting — Conference Room Café Lights/);
  assert.match(liveMigration, /Venue Lighting — Porch Solar Lights/);
  assert.match(liveMigration, /'coffee_bar','Coffee Bar','work_station'/);
  assert.match(liveMigration, /'bouquet_wrapping_station','Bouquet Wrapping Station','work_station'/);
});

test("Day completion truth includes carried tasks completed on the selected day", () => {
  assert.match(contractMigration, /home_task_cards_for_membership_v3/);
  assert.match(contractMigration, /task\.completed_at at time zone 'America\/Chicago'/);
  assert.match(contractMigration, /task\.assigned_membership_id = p_membership_id/);
  assert.match(contractMigration, /join atlas\.tasks task on task\.id=card\.task_id/);
});

test("Farm Hand move context cannot surface another person's unlocks", () => {
  assert.match(contractMigration, /'assigneeMembershipId', d\.assigned_membership_id/);
  assert.match(route, /row\.assigneeMembershipId === membershipId/);
  assert.match(route, /assigneeName: "You"/);
});
