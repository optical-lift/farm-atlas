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
const sessionRoute = read("app/api/atlas/weed-card-session/route.ts");
const partialRoute = read("app/api/atlas/weed-card-partial/route.ts");

test("canonical weed work enters the persistent Weed Card family", () => {
  assert.match(canonical, /function isWeedTask\(task: AtlasTaskCard\)/);
  assert.match(canonical, /task\.action_key === "weed"/);
  assert.match(canonical, /task\.task_type === "weed"/);
  assert.match(canonical, /WeedCardTaskLoader/);
  assert.match(loader, /\/api\/atlas\/weed-card\?taskId=/);
  assert.match(loader, /WeedCardTaskFocus/);
  assert.match(loader, /if \(card\) return <WeedCardTaskFocus/);
});

test("production Weed Card uses bed truth with current use, history, active crops, and canonical geometry", () => {
  assert.match(focus, /AtlasTaskCardFrame/);
  assert.match(focus, /family="Weed"/);
  assert.match(focus, /familyDetail=\{card\.bedUseCategory\}/);
  assert.match(focus, /title=\{card\.objectLabel\}/);
  assert.match(focus, /subtitle=\{card\.zoneLabel/);
  assert.match(focus, /Last weeded ·/);
  assert.match(focus, /data-atlas-weed-card-template="task-card-lab-v4-spatial-result"/);
  assert.match(focus, />Bed now</);
  assert.match(focus, /card\.mainCropLabel/);
  assert.match(focus, /Unknown main crop/);
  assert.doesNotMatch(focus, /Last logged as/);
  assert.match(focus, />Active Crops</);
  assert.match(focus, /card\.bedTrail/);
  assert.match(focus, /card\.bedMap/);
  assert.match(focus, /CropOccupancyBedMap/);
  assert.match(focus, /variant="notebook"/);
  assert.match(focus, />How’d we do\?</);
  assert.match(focus, /card\.sessions/);
  assert.match(focus, /card\.condition/);
  assert.doesNotMatch(focus, /card\.targetCondition|Target ·/);
  assert.doesNotMatch(focus, /Field Row 13|ProCut Orange|12 ft|3 rows|Jun 10/);
  assert.doesNotMatch(focus, /AssignedTaskExecutionShell|atlas-phone-top|atlas-phone-brand|atlas-note-plus/);
});

test("Weed Card reports canonical physical condition through one three-way Save result control", () => {
  assert.match(focus, /WEED_RESULTS/);
  assert.match(focus, /Still rough/);
  assert.match(focus, /Mostly clear/);
  assert.match(focus, /All clear/);
  assert.match(focus, /Save result/);
  assert.match(focus, /postAtlasFinishPartialWeedCardDay/);
  assert.match(focus, /postAtlasWeedCardSession/);
  assert.match(focus, />Blocked</);
  assert.doesNotMatch(focus, /Finish Weed/);
  assert.doesNotMatch(focus, /postAtlasTaskSetAsideToday|Move this card/);
  assert.doesNotMatch(focus, /minutes:\s*[1-9]/);
  assert.match(focus, /minutes: null/);
  assert.match(client, /finish-partial-day|weed-card/);
});

test("Weed Card requires a written observation before Save result at UI and API boundaries", () => {
  assert.match(focus, /Log it/);
  assert.match(focus, /aria-expanded=\{logOpen\}/);
  assert.match(focus, /logOpen \? \(/);
  assert.match(focus, /Log what you observed/);
  assert.match(focus, /disabled=\{busy \|\| !selectedCondition \|\| !note\.trim\(\)\}/);
  assert.doesNotMatch(focus, /Note \(optional\)/);
  assert.match(sessionRoute, /weed_card_observation_required/);
  assert.match(partialRoute, /weed_card_observation_required/);
  assert.match(sessionRoute, /if \(!note\)/);
  assert.match(partialRoute, /if \(!note\)/);
  assert.doesNotMatch(focus, /Move this card|Tomorrow|Choose return date|postAtlasTaskSetAsideToday/);
});
