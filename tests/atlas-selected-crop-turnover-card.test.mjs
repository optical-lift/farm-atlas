import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("selected crop turnover is a Clear variant of the canonical Weed card renderer", () => {
  const loader = read("components/atlas/weed-card-task-loader.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const route = read("app/api/atlas/weed-card/turnover/route.ts");

  assert.equal(existsSync(join(root, "components/atlas/selected-crop-turnover-task-focus.tsx")), false);
  assert.doesNotMatch(loader, /SelectedCropTurnoverTaskFocus/);
  assert.match(loader, /<WeedCardTaskFocus[^>]*turnover=/);

  assert.match(focus, /family="Clear"/);
  assert.match(focus, /familyDetail="bed turnover"/);
  assert.match(focus, /After harvest · clearing due/);
  assert.match(focus, /tap to cross off/);
  assert.match(focus, /Take \$\{crop\} biomass to \$\{turnover\.biomassDestination\}/);
  assert.match(focus, /Selected crop only · foot-bed crops stay in place/);
  assert.match(focus, /onDone=\{\(\) => void finish\("done"\)\}/);
  assert.match(focus, /onUnfinished=\{\(\) => void finish\("partial"\)\}/);
  assert.doesNotMatch(focus, /Partly removed|Removed<\/button>/);

  assert.match(route, /object_crop_bed_map_v1/);
  assert.match(route, /bedMaps/);
  assert.match(route, /role", "clears"/);
});
