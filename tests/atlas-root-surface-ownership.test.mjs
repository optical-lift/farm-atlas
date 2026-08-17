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

test("RootLayout mounts shared services while farm services stay behind the operational projection boundary", () => {
  const layout = read("app/layout.tsx");
  const operationalGlobals = read("components/atlas/shell/AtlasOperationalProjectionGlobals.tsx");

  for (const patch of retiredRootPatches) {
    assert.doesNotMatch(layout, new RegExp(patch));
    assert.equal(existsSync(new URL(`../app/${patch}.tsx`, import.meta.url)), false);
  }

  assert.match(layout, /AtlasContextualAppFrame/);
  assert.match(layout, /AtlasOperationalProjectionGlobals/);
  assert.match(operationalGlobals, /AtlasSkyLedgerMaintainer/);
  assert.match(operationalGlobals, /DependencyReleaseFlash/);
  assert.match(operationalGlobals, /OwnerDayPlanGate/);
  assert.match(operationalGlobals, /if \(isPrincipalProjection\(pathname\)\) return null/);
});

test("set-aside task membership is enforced by the dated task reader, not hidden after render", () => {
  const route = read("app/api/atlas/universal-task-cards/route.ts");

  assert.match(route, /readAtlasTaskDayDispositions\(doneDate\)/);
  assert.match(route, /setAsideTaskIds/);
  assert.match(route, /\.filter\(\(card\) => !setAsideTaskIds\.has\(card\.task_id\)\)/);
  assert.doesNotMatch(route, /document\.|MutationObserver|createPortal/);
});
