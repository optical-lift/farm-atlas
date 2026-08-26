import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("selected crop Clear travels through the exact same bed-work card renderer as Weed", () => {
  const loader = read("components/atlas/weed-card-task-loader.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const route = read("app/api/atlas/weed-card/turnover/route.ts");

  assert.equal(existsSync(join(root, "components/atlas/selected-crop-turnover-task-focus.tsx")), false);
  assert.doesNotMatch(loader, /SelectedCropTurnoverTaskFocus/);
  assert.match(loader, /<WeedCardTaskFocus task=\{task\} turnover=\{turnover\}/);

  assert.equal((focus.match(/<AtlasTaskCardFrame/g) || []).length, 1);
  assert.match(focus, /data-atlas-weed-card-template="task-card-lab-v4-spatial-result"/);
  assert.match(focus, /const family = isClear \? "Clear" : "Weed"/);
  assert.match(focus, /const familyDetail = turnover \? clearCrop \|\| turnover\.cropLabel/);
  assert.match(focus, /const objectLabel = turnover \? turnover\.collectionLabel/);
  assert.match(focus, /const mainCropLabel = turnover \? clearCrop/);
  assert.match(focus, />Bed now</);
  assert.match(focus, />Active Crops</);
  assert.match(focus, /MaintenanceDirectiveStrip taskId=\{task\.task_id\}/);
  assert.match(focus, />Recent passes</);
  assert.match(focus, />How’d we do\?</);
  assert.match(focus, />Log it</);
  assert.match(focus, />Blocked</);
  assert.match(focus, /Save result/);
  assert.match(focus, /Still rough/);
  assert.match(focus, /Mostly clear/);
  assert.match(focus, /All clear/);

  assert.doesNotMatch(focus, /SelectedCropClearCard|ClearTurnoverCard|bed turnover|tap to cross off|turnoverMethod|turnoverCategory|turnoverReminder/);
  assert.doesNotMatch(focus, /task-card-editor-clear-variant/);
  assert.doesNotMatch(focus, /onDone=|onUnfinished=/);

  assert.match(route, /object_crop_bed_map_v1/);
  assert.match(route, /object_crop_occupancy_v1/);
  assert.match(route, /occupancyGroups/);
  assert.match(route, /bedTrail/);
  assert.match(route, /sessions/);
  assert.match(route, /zoneLabel/);
  assert.match(route, /role", "clears"/);
});
