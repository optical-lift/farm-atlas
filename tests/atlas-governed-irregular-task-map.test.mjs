import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("task and Weed map routes consume the governed DB bed-map RPC", () => {
  assert.match(read("app/api/atlas/task-bed-map/route.ts"), /object_crop_bed_map_v1/);
  assert.match(read("app/api/atlas/weed-card/route.ts"), /object_crop_bed_map_v1/);
});

test("notebook maps give governed irregular geometry authority over rectangle fallbacks", () => {
  const wrapper = read("components/atlas/crop-occupancy-bed-map.tsx");
  assert.match(wrapper, /variant === "notebook" && hasGovernedReferenceGeometry\(map\)/);
  assert.match(wrapper, /return <ReferenceGeometryBedMap map=\{map\} \/>/);
  assert.match(wrapper, /LegacyCropOccupancyBedMap/);
});

test("governed geometry renderer supports Main Garden polygons and curved SVG paths without treating reference coordinates as feet", () => {
  const renderer = read("components/atlas/reference-geometry-bed-map.tsx");
  assert.match(renderer, /atlas_object_geometry_v1/);
  assert.match(renderer, /reference\.kind === "polygon"/);
  assert.match(renderer, /reference\.kind === "path"/);
  assert.match(renderer, /<polygon points=\{polygonPoints\}/);
  assert.match(renderer, /<path d=\{reference!\.path_d/);
  assert.match(renderer, /reference outline · not surveyed from drawing/);
  assert.match(renderer, /exact positions inside this irregular shape are not yet mapped/);
  assert.doesNotMatch(renderer, /one mark = 1 sq ft/);
});
