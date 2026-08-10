import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detail = readFileSync(
  new URL("../components/atlas/concise-weed-task-detail.tsx", import.meta.url),
  "utf8",
);

test("weed fallback uses the universal Task Move execution shell", () => {
  assert.match(detail, /AssignedTaskExecutionShell/);
  assert.match(detail, /data-atlas-method-instrument="weed-fallback"/);
  assert.doesNotMatch(detail, /TaskDominionTrail/);
  assert.doesNotMatch(detail, /DominionAssignedTaskDetail/);
  assert.doesNotMatch(detail, /taskConditionRailModel/);
  assert.doesNotMatch(detail, /<main className="atlas-phone-shell/);
  assert.doesNotMatch(detail, /\/api\/atlas\/weather/);
  assert.doesNotMatch(detail, /postAtlasTaskTransition/);
});

test("weed fallback preserves real bed and plant context as a method instrument", () => {
  assert.match(detail, /fetchAtlasTaskPlantContents/);
  assert.match(detail, /Work area/);
  assert.match(detail, /Plants in this bed/);
  assert.match(detail, /shortObjectLabel/);
});
