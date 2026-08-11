import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const retiredRootPatches = [
  "WorkerVocabularyCleanupPatch",
  "TaskProgressExactDayPatch",
  "SafeBedCropAccordionPatch",
  "AttachedTaskHistoryPatch",
  "UniversalCollectionIdentity",
  "DayTaskTitleLinkPatch",
  "TaskSetAsideDayPatch",
  "DayConsequenceTimelinePatch",
  "AtlasFarmConditionsHomePatch",
];

test("RootLayout mounts services, not corrective render patches", () => {
  const layout = read("app/layout.tsx");

  for (const patch of retiredRootPatches) {
    assert.doesNotMatch(layout, new RegExp(patch));
    assert.equal(existsSync(new URL(`../app/${patch}.tsx`, import.meta.url)), false);
  }

  assert.match(layout, /AtlasSkyLedgerMaintainer/);
  assert.match(layout, /AtlasContextualAppFrame/);
  assert.match(layout, /DependencyReleaseFlash/);
  assert.match(layout, /OwnerDayPlanGate/);
});

test("set-aside task membership is enforced by the dated task reader, not hidden after render", () => {
  const route = read("app/api/atlas/universal-task-cards/route.ts");

  assert.match(route, /readAtlasTaskDayDispositions\(doneDate\)/);
  assert.match(route, /setAsideTaskIds/);
  assert.match(route, /\.filter\(\(card\) => !setAsideTaskIds\.has\(card\.task_id\)\)/);
  assert.doesNotMatch(route, /document\.|MutationObserver|createPortal/);
});
