import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("parent Done cascades ordinary execution components while structured result guards stay ahead of the cascade", () => {
  const closeout = read("supabase/migrations/20260822005627_global_task_closeout_components_v1.sql");
  const carryover = read("supabase/migrations/20260822005739_global_partial_carryover_v1.sql");

  assert.match(closeout, /complete_task_execution_components_v1/);
  assert.match(closeout, /'source', 'parent_attestation'/);
  assert.match(closeout, /'parent_task_done', true/);
  assert.match(closeout, /v_checklist_closed := atlas\.complete_task_execution_components_v1/);
  assert.ok(closeout.indexOf("structured_harvest_result_required") < closeout.indexOf("complete_task_execution_components_v1(\n      p_task_id"));
  assert.ok(closeout.indexOf("seed_inventory_report_required") < closeout.indexOf("complete_task_execution_components_v1(\n      p_task_id"));

  assert.match(carryover, /component_scope_snapshot/);
  assert.match(carryover, /unfinished_requested_return_date/);
  assert.match(carryover, /atlas\.set_task_aside_today_v2/);
  assert.match(carryover, /unfinishedCarryover/);
});

test("ordinary checklist attestation remains available while Venue-required actions gate Venue closeout", () => {
  const checklist = read("components/atlas/execution-checklist-task-detail.tsx");
  const cropMove = read("components/atlas/crop-move-task-detail.tsx");
  const venue = read("components/atlas/venue-task-detail.tsx");

  assert.doesNotMatch(checklist, /doneDisabled=\{checklist\?\.ready !== true\}/);
  assert.doesNotMatch(checklist, /Finish the required lines before marking the task done/);
  assert.doesNotMatch(cropMove, /const doneDisabled = hasChecklist/);
  assert.doesNotMatch(cropMove, /disabled=\{busy \|\| doneDisabled\}/);
  assert.match(venue, /TaskPrimaryResultControls/);
  assert.match(venue, /doneDisabled=\{!checklist \|\| !checklist\.ready\}/);
  assert.match(venue, /checklistCompleteBeforeClose: checklist\?\.ready === true/);
});

test("Unfinished is globally resumable and partial exits the current work session", () => {
  const unfinished = read("components/atlas/structured-unfinished-control.tsx");
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");

  assert.doesNotMatch(unfinished, /taskAllowsPartlyDone/);
  assert.doesNotMatch(unfinished, /postAtlasTaskSetAsideToday/);
  assert.match(unfinished, /preserveCompletedComponents: true/);
  assert.match(unfinished, /carryRemainingComponents: true/);
  assert.match(unfinished, /requestedReturnDate: returnDate/);
  assert.match(shell, /outcome === "partial" \|\| outcome === "not_relevant"/);
  assert.match(shell, /window\.location\.assign\(returnDestination\(assignee\.listPath\)\)/);
});

test("Venue Reset v2 is a reusable location-resource-work-ready-result card and owns clean-restore routing", () => {
  const card = read("components/atlas/venue-reset-task-detail.tsx");
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const data = read("supabase/migrations/20260822010237_venue_reset_place_restore_v1.sql");
  const checklist = read("supabase/migrations/20260822010316_venue_reset_checklist_components_v1.sql");

  assert.match(card, /data-atlas-venue-reset="v2"/);
  assert.match(card, /TaskPrimaryResultControls/);
  assert.match(card, />Location</);
  assert.match(card, />Resources</);
  assert.match(card, />Reset work</);
  assert.match(card, /venue_reset_ready_result/);
  assert.match(card, /task\.resource_requirements/);
  assert.match(card, /fallbackSteps/);
  assert.match(card, /execution_how/);
  assert.match(card, /transition: kind/);
  assert.match(card, /venueResetVersion: 2/);
  assert.match(card, /checklistCompleteBeforeClose/);
  assert.match(card, /doneDisabled=\{!requiredReady\}/);

  assert.match(canonical, /function isVenueResetTask/);
  assert.match(canonical, /operation_class === "clean_restore"/);
  assert.match(canonical, /<VenueResetTaskDetail \{\.\.\.props\} \/>/);
  assert.ok(canonical.indexOf("if (isVenueResetTask") < canonical.indexOf("if (isExecutionChecklistTask"));

  assert.match(data, /anna_20260811_gentle_pressure_wash_detached_garage_face/);
  assert.match(data, /small_pressure_washer/);
  assert.match(data, /anna_20260727_two_house_doors_purple_first_coat/);
  assert.match(data, /'task_style','venue_reset'/);
  assert.match(checklist, /jsonb_array_elements_text\(v_task\.metadata->'execution_how'\)/);
  assert.match(checklist, /'venue_reset_component',true/);
});
