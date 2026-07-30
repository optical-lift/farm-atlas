import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/page.tsx", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const component = readFileSync("components/atlas/home/AtlasUniversalHomeV2.tsx", "utf8");
const overview = readFileSync("lib/atlas/home-task-overview.ts", "utf8");
const css = readFileSync("components/atlas/home/universal-home-v2.module.css", "utf8");

test("farm-hand Home uses the prepared Living Day instead of journal-cover miscellany", () => {
  assert.match(page, /readAtlasOperatorHomeTaskOverview/);
  assert.match(overview, /living_day_v1/);
  assert.match(overview, /livingDay\.journal\.planned/);
  assert.match(overview, /home\.viewer\.canManageAnyFarm \|\| home\.viewer\.canManageAnyPortfolio/);
  assert.doesNotMatch(page, /readAtlasOperatorJournalCover/);
});

test("the purple cover is a four-card overview in canonical work order", () => {
  assert.match(overview, /atlasWorkOrderSortValue/);
  assert.match(overview, /slice\(0, 4\)/);
  assert.match(overview, /Current/);
  assert.match(overview, /Next/);
  assert.match(overview, /Later/);
  assert.match(component, /data-atlas-home-task-board="true"/);
  assert.match(component, /"Finish"/);
});

test("prepared journal tasks fill farm-hand overview slots when the farm-card cache is incomplete", () => {
  assert.match(overview, /AtlasJournalTask/);
  assert.match(overview, /cardsById/);
  assert.match(overview, /taskRefMove/);
  assert.match(overview, /preparedOpen/);
});

test("managerial portals separate personal work from staff oversight", () => {
  assert.match(overview, /function oversightOverview/);
  assert.match(overview, /function personalTaskRefs/);
  assert.match(overview, /function staffSummaryMoves/);
  assert.match(overview, /shared_with_membership_ids/);
  assert.match(overview, /shared_with_worker_keys/);
  assert.match(overview, /Anna has|workerLabel/);
  assert.match(overview, /First:/);
  assert.match(overview, /kind: "collection"/);
  assert.match(overview, /personalScope: true/);
});

test("Lex can see personal work across farms without leaking employee tasks as personal cards", () => {
  assert.match(overview, /home\.farms\.forEach/);
  assert.match(overview, /assigned_membership_id/);
  assert.match(overview, /membershipIds\.has/);
  assert.match(component, /Today across/);
  assert.match(component, /personal tasks dealt with/);
  assert.match(component, /move\.kind === "farm_task"/);
  assert.match(component, /data-position=\{taskPosition\}/);
});

test("Home reports the bounded personal plan and leaves project movement in Projects", () => {
  assert.match(component, /dealt with/);
  assert.match(component, /carry forward/);
  assert.doesNotMatch(component, /function MovingNow/);
});

test("the rebuilt Home board is isolated from legacy daily-run-sheet CSS", () => {
  assert.doesNotMatch(component, /atlas-home-task-overview-card/);
  assert.doesNotMatch(component, /atlas-daily-run-sheet/);
  assert.doesNotMatch(component, /atlas-run-sheet-grid/);
  assert.doesNotMatch(layout, /import "\.\/home-task-overview\.css"/);
  assert.match(component, /styles\.heroMoveBody/);
  assert.match(component, /styles\.heroAction/);
});

test("task cards show complete real task data and keep the action horizontal", () => {
  assert.match(overview, /atlasDayTaskFamily/);
  assert.match(overview, /atlasDayTaskCues/);
  assert.match(overview, /display\.location/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /grid-template-rows: minmax\(0, 1fr\) auto/);
  assert.match(css, /white-space: nowrap/);
  assert.match(css, /min-width: 72px/);
});

test("the task hero, compact week rail, and farm stories size to their contents", () => {
  assert.match(css, /grid-auto-rows: max-content/);
  assert.match(css, /align-content: start/);
  assert.match(css, /\.todayStack[\s\S]*gap: 8px/);
  assert.match(css, /\.days[\s\S]*grid-template-columns: repeat\(7/);
  assert.match(css, /\.farmsSection[\s\S]*display: grid/);
  assert.match(component, /data-atlas-home-time-rail="true"/);
});

test("the lower Home surface uses canonical farm snapshots instead of generic pulse totals", () => {
  assert.match(component, /farm\.snapshot/);
  assert.match(component, /snapshot\.growingBeds/);
  assert.match(component, /snapshot\.activeSqft/);
  assert.match(component, /snapshot\.stemsLogged/);
  assert.match(component, /snapshot\.sowingsLogged/);
  assert.doesNotMatch(component, /FarmPulse|known gaps|today&apos;s hand/);
});
