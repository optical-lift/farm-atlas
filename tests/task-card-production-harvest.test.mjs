import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const taskPage = read("app/task-focus/[taskId]/page.tsx");
const watch = read("app/task-focus/[taskId]/HarvestWatchFocusPage.tsx");
const cut = read("app/task-focus/[taskId]/HarvestCutFocusPage.tsx");
const watchRoute = read("app/api/atlas/harvest-watch/route.ts");
const cutRoute = read("app/api/atlas/harvest-cut/route.ts");

test("Harvest Watch and real crop harvest keep their existing strict Task Focus routing", () => {
  assert.match(taskPage, /function isHarvestWatchTask/);
  assert.match(taskPage, /task\.task_type === "harvest_watch"/);
  assert.match(taskPage, /function isCropHarvestTask/);
  assert.match(taskPage, /task\.task_type === "crop_harvest"/);
  assert.match(taskPage, /HarvestWatchFocusPage/);
  assert.match(taskPage, /HarvestCutFocusPage/);
});

test("Harvest Watch uses the approved Harvest family while preserving crop-cycle truth", () => {
  assert.match(watch, /AtlasTaskCardFrame/);
  assert.match(watch, /family="Harvest"/);
  assert.match(watch, /familyDetail="crop-cycle truth"/);
  assert.match(watch, /data-atlas-harvest-card="watch"/);
  assert.match(watch, /title=\{crop\}/);
  assert.match(watch, /subtitle=\{task\.objectLabel\}/);
  assert.match(watch, />Crop now</);
  assert.match(watch, />Harvest board</);
  assert.match(watch, /What is physically true\?/);
  assert.doesNotMatch(watch, /atlas-phone-top|atlas-phone-brand|atlas-note-plus/);
});

test("Harvest Watch exposes only supported observation outcomes through its existing safe endpoint", () => {
  for (const action of ["not_ready", "beginning", "harvestable", "declining", "finished", "problem_or_uncertain"]) {
    assert.match(watch, new RegExp(action));
  }
  assert.match(watch, /\/api\/atlas\/harvest-watch/);
  assert.match(watchRoute, /record_harvest_watch_result_for_member_v1|record_harvest_watch/);
  assert.doesNotMatch(watch, /deadheaded|backdate|nothing_ready|left_for_later/);
});

test("Harvest Cut uses the approved Harvest family with canonical bucket-scale output", () => {
  assert.match(cut, /AtlasTaskCardFrame/);
  assert.match(cut, /family="Harvest"/);
  assert.match(cut, /familyDetail="crop-cycle truth"/);
  assert.match(cut, /data-atlas-harvest-card="cut"/);
  assert.match(cut, />Today’s harvest</);
  assert.match(cut, /quarter/);
  assert.match(cut, /half/);
  assert.match(cut, /three_quarters/);
  assert.match(cut, /more_than_one/);
  assert.match(cut, /More remains/);
  assert.match(cut, /Harvest finished/);
  assert.match(cut, /moreAvailable/);
  assert.match(cut, /\/api\/atlas\/harvest-cut/);
  assert.match(cutRoute, /record_flower_harvest_output_for_member_v1/);
});

test("Harvest production UI never copies specimen stem math or specimen crop values", () => {
  assert.match(cut, /No stem conversion is invented/);
  assert.doesNotMatch(cut, /=\s*10\s*stems|=\s*20\s*stems|10 stems|20 stems/);
  assert.doesNotMatch(cut, /White Lite|Jun 10|Field Row 6/);
  assert.doesNotMatch(watch, /White Lite|Jun 10|Field Row 6/);
  assert.doesNotMatch(cut, /atlas-phone-top|atlas-phone-brand|atlas-note-plus/);
});
