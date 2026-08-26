import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("selected crop Clear uses the exact canonical bed-work renderer instead of a Clear variant", () => {
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const loader = read("components/atlas/weed-card-task-loader.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const route = read("app/api/atlas/weed-card/turnover/route.ts");

  assert.equal(existsSync(join(root, "components/atlas/selected-crop-turnover-task-focus.tsx")), false);
  assert.doesNotMatch(focus, /SelectedCropClearCard|ClearTrail|ClearReminder|tap to cross off|bed turnover/);
  assert.match(canonical, /task\.metadata\?\.canonical_card_family === "weed"/);
  assert.match(loader, /data\.card/);
  assert.match(loader, /<WeedCardTaskFocus[^>]*card=\{card\}[^>]*turnover=/);

  assert.match(focus, /data-atlas-weed-card-template="task-card-lab-v4-spatial-result"/);
  assert.match(focus, /const actionLabel = clearMode \? "Clear" : "Weed"/);
  assert.match(focus, /const actionDetail = selectedCrop \|\| card\.bedUseCategory/);
  assert.match(focus, /title=\{card\.objectLabel\}/);
  assert.match(focus, /card\.bedTrail/);
  assert.match(focus, />Bed now</);
  assert.match(focus, /CropOccupancyBedMap/);
  assert.match(focus, />Active Crops</);
  assert.match(focus, /MaintenanceDirectiveStrip/);
  assert.match(focus, />Recent passes</);
  assert.match(focus, />How’d we do\?</);
  assert.match(focus, />Log it</);
  assert.match(focus, />Blocked</);
  assert.match(focus, /Save result/);
  assert.match(focus, /Still there/);
  assert.match(focus, /Partly removed/);
  assert.match(focus, /Removed/);

  assert.match(route, /weed_selected_crop_turnover_focus_v1/);
  assert.match(route, /object_crop_bed_map_v1/);
  assert.match(route, /capacitySurfaces/);
  assert.match(route, /occupancyGroups/);
  assert.match(route, /bedTrail/);
  assert.match(route, /sessions/);
  assert.match(route, /card:/);

  for (const protectedTable of ["task_crop_cycles", "crop_cycles", "crop_placements", "growing_objects", "weed_cards", "weed_sessions", "task_objects"]) {
    assert.doesNotMatch(route, new RegExp(`from\\(\\\"${protectedTable}\\\"\\)`));
  }
});