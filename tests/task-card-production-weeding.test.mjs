import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const loader = read("components/atlas/weed-card-task-loader.tsx");
const focus = read("components/atlas/weed-card-task-focus.tsx");
const client = read("lib/atlas/weed-card-client.ts");

test("canonical weed work enters the persistent Weed Card family", () => {
  assert.match(canonical, /function isWeedTask\(task: AtlasTaskCard\)/);
  assert.match(canonical, /task\.action_key === "weed"/);
  assert.match(canonical, /task\.task_type === "weed"/);
  assert.match(canonical, /WeedCardTaskLoader/);
  assert.match(loader, /weed_card_task_focus_v1/);
  assert.match(loader, /WeedCardTaskFocus/);
});

test("production Weed Card uses the approved bed-care grammar with live object truth", () => {
  assert.match(focus, /AtlasTaskCardFrame/);
  assert.match(focus, /family="Weed"/);
  assert.match(focus, /familyDetail="bed care"/);
  assert.match(focus, /title=\{card\.objectLabel\}/);
  assert.match(focus, /subtitle=\{card\.zoneLabel/);
  assert.match(focus, /data-atlas-weed-card-template="task-card-lab-v1"/);
  assert.match(focus, />Bed now</);
  assert.match(focus, />How’d we do\?</);
  assert.match(focus, /CropOccupancyList/);
  assert.match(focus, /card\.sessions/);
  assert.match(focus, /card\.condition/);
  assert.match(focus, /card\.targetCondition/);
  assert.doesNotMatch(focus, /Field Row 13|ProCut Orange|12 ft|3 rows|Jun 10/);
  assert.doesNotMatch(focus, /AssignedTaskExecutionShell|atlas-phone-top|atlas-phone-brand|atlas-note-plus/);
});

test("Weed Card reports canonical physical condition without fabricating elapsed time", () => {
  assert.match(focus, /ATLAS_WEED_CONDITIONS\.slice\(currentIndex\)/);
  assert.match(focus, /postAtlasFinishPartialWeedCardDay/);
  assert.match(focus, /postAtlasWeedCardSession/);
  assert.match(focus, /Done weeding today/);
  assert.match(focus, />Blocked</);
  assert.match(focus, /postAtlasTaskSetAsideToday/);
  assert.doesNotMatch(focus, /minutes:\s*[1-9]/);
  assert.match(focus, /minutes: null/);
  assert.match(client, /finish-partial-day|weed-card/);
});

test("Weed Card keeps notes and movement secondary to the physical bed result", () => {
  assert.match(focus, /Log it/);
  assert.match(focus, /Field note logged/);
  assert.match(focus, /Move this card/);
  assert.match(focus, /Tomorrow/);
  assert.match(focus, /Choose return date/);
});
