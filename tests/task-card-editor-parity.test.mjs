import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const venue = await readFile(new URL("../components/atlas/venue-task-detail.tsx", import.meta.url), "utf8");
const venueRail = await readFile(new URL("../components/atlas/task-card-venue-rail.module.css", import.meta.url), "utf8");
const farmRound = await readFile(new URL("../components/atlas/farm-round-task-detail.tsx", import.meta.url), "utf8");
const farmRoundCss = await readFile(new URL("../components/atlas/farm-round-task-detail.module.css", import.meta.url), "utf8");
const cropMove = await readFile(new URL("../components/atlas/crop-move-task-detail.tsx", import.meta.url), "utf8");
const cropMoveCss = await readFile(new URL("../components/atlas/crop-move-task-detail.module.css", import.meta.url), "utf8");
const workerReady = await readFile(new URL("../components/atlas/worker-ready-assigned-task-execution-shell.tsx", import.meta.url), "utf8");
const thinAdapter = await readFile(new URL("../components/atlas/thin-crop-cycle-task-card.tsx", import.meta.url), "utf8");
const thinPage = await readFile(new URL("../app/task-focus/[taskId]/ThinCropCycleFocusPage.tsx", import.meta.url), "utf8");
const farmRoundFuture = await readFile(new URL("../supabase/migrations/20260822001955_farm_round_future_preview_note_v7.sql", import.meta.url), "utf8");
const venueMetadata = await readFile(new URL("../supabase/migrations/20260822001242_venue_checklist_editor_metadata_v2.sql", import.meta.url), "utf8");

test("Venue production card owns the Task Card Editor lifecycle and local rail", () => {
  assert.doesNotMatch(venue, /AssignedTaskExecutionShell/);
  assert.match(venue, /AtlasTaskCardFrame/);
  assert.match(venue, /TRAIL/);
  assert.match(venue, /rail\.trailNow/);
  assert.match(venue, /rail\.localStation/);
  assert.match(venue, /rail\.localReminderRow/);
  assert.match(venue, /item\.restockLabel/);
  assert.match(venue, /rail\.classicChecklist/);
  assert.doesNotMatch(venue, /same initial Venue grammar/i);
  assert.match(venueRail, /\.trailNow::before/);
  assert.match(venueRail, /\.localReminderRow::after/);
});

test("Venue checklist API preserves Editor interaction metadata instead of UI label hacks", () => {
  assert.match(venueMetadata, /'interaction',x\.interaction/);
  assert.match(venueMetadata, /'stationLocation',x\.station_location/);
  assert.match(venueMetadata, /'restockLabel',x\.restock_label/);
  assert.match(venueMetadata, /'Dining room'/);
  assert.match(venueMetadata, /'For sale at Community Thursday'/);
});

test("Farm Round owns its route instrument inside canonical Task Focus geometry", () => {
  assert.match(farmRound, /AtlasTaskCardFrame/);
  assert.match(farmRound, /roundStyles\.route/);
  assert.match(farmRound, /roundStyles\.stop/);
  assert.match(farmRound, /roundStyles\.item/);
  assert.match(farmRound, /farm_round_issue_options/);
  assert.doesNotMatch(farmRound, /task-card-venue-rail/);
  assert.doesNotMatch(farmRound, /rail\./);
  assert.match(farmRoundCss, /width:min\(100%,520px\)/);
  assert.match(farmRoundCss, /\.route/);
  assert.match(farmRoundCss, /\.stop/);
  assert.match(farmRoundCss, /\.item/);
});

test("future Farm Round projection emits only top-level parents and carries the miniature member preview", () => {
  assert.match(farmRoundFuture, /occurrence\.parent_occurrence_id is null/);
  assert.match(farmRoundFuture, /occurrence\.source_kind in \('recurring_task','farm_round'\)/);
  assert.match(farmRoundFuture, /'note', case when occurrence\.source_kind='farm_round'/);
  assert.match(farmRoundFuture, /refresh_farm_round_preview_v1/);
});

test("Crop Move owns the Editor lifecycle and Source-to-Destination grammar without generic ticket nesting", () => {
  assert.doesNotMatch(cropMove, /AssignedTaskExecutionShell/);
  assert.match(cropMove, /AtlasTaskCardFrame/);
  assert.match(cropMove, /styles\.trailNow/);
  assert.match(cropMove, /styles\.moveSection/);
  assert.match(cropMove, /Report source issue/);
  assert.match(cropMove, /Report destination issue/);
  assert.match(cropMoveCss, /\.moveSection/);
  assert.match(cropMoveCss, /\.issueDrawer/);
});

test("Thin ProCut Horizon keeps thinning truth while using the Sow visual family", () => {
  assert.match(workerReady, /isThinCropCycleTask/);
  assert.match(workerReady, /ThinCropCycleTaskCard/);
  assert.match(thinAdapter, /task\.task_type === "thinning"/);
  assert.match(thinAdapter, /task\.action_key === "thin"/);
  assert.match(thinAdapter, /task\.operation_class === "remove_uproot"/);
  assert.match(thinPage, /DirectSowFocus\.module\.css/);
  assert.match(thinPage, /family="Thin"/);
  assert.match(thinPage, /label: "Sown"/);
  assert.match(thinPage, /label: "Germinated"/);
  assert.match(thinPage, /label: "Thin"/);
  assert.match(thinPage, /thinCardFamily: true/);
});
