import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Farm Conditions render inside the canonical Home farm card", () => {
  const home = read("components/atlas/home/AtlasUniversalHomeV2.tsx");
  const panel = read("components/atlas/home/FarmConditionsPanel.tsx");
  const layout = read("app/layout.tsx");

  assert.equal(existsSync(new URL("../app/AtlasFarmConditionsHomePatch.tsx", import.meta.url)), false);
  assert.doesNotMatch(layout, /AtlasFarmConditionsHomePatch/);
  assert.match(home, /FarmConditionsPanel/);
  assert.match(home, /data-farm-id=\{farm\.farmId\}/);
  assert.match(home, /conditionsByFarmId\[farm\.farmId\]/);
  assert.match(panel, /data-farm-id=\{conditions\.farm\.id\}/);
  assert.doesNotMatch(panel, /MutationObserver/);
  assert.doesNotMatch(panel, /createPortal/);
});
