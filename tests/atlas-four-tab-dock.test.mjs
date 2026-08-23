import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const dockProfile = readFileSync(new URL("../lib/atlas/dock-profile.ts", import.meta.url), "utf8");
const more = readFileSync(new URL("../app/more/page.tsx", import.meta.url), "utf8");
const zones = readFileSync(new URL("../app/zones/page.tsx", import.meta.url), "utf8");

test("the app dock keeps universal destinations while capability profiles decide whether Manager appears", () => {
  for (const label of ["Home", "Work", "Clock", "Manager", "Harvest", "More"]) {
    assert.match(shell, new RegExp(`label: "${label}"`));
  }
  assert.match(shell, /atlasDockProfileForRole\(effectiveFarmRole\)/);
  assert.match(shell, /manager: \{ key: "manager", label: "Manager", href: farmManagerHref \}/);
  assert.match(shell, /atlasDockKeys\(dockProfile\)\.map/);
  assert.match(dockProfile, /FULL_DOCK_KEYS[\s\S]*"manager"/);
  assert.doesNotMatch(dockProfile.match(/FIELD_WORKER_DOCK_KEYS[\s\S]*?\];/)?.[0] ?? "", /"manager"/);
  assert.match(shell, /gridTemplateColumns: `repeat\(\$\{items\.length\}, minmax\(0, 1fr\)\)`/);
  assert.doesNotMatch(shell, /key: "places"/);
  assert.doesNotMatch(shell, /label: "Places"/);
});

test("dock icons share one canonical key type and custom SVG family including Clock and Manager", () => {
  assert.match(dockProfile, /export type AtlasDockKey = "home" \| "work" \| "clock" \| "manager" \| "harvest" \| "more"/);
  assert.match(shell, /type DockIconKey = AtlasDockKey/);
  assert.match(shell, /if \(kind === "clock"\)/);
  assert.match(shell, /if \(kind === "manager"\)/);
  assert.match(shell, /viewBox: "0 0 24 24"/);
  assert.match(shell, /stroke: "currentColor"/);
  assert.match(shell, /strokeWidth: 1\.9/);
  assert.equal(shell.match(/<svg \{\.\.\.common\}/g)?.length, 6);
  for (const legacyGlyph of ["⌂", "✓", "⌖", "✂", "•••"]) {
    assert.doesNotMatch(shell, new RegExp(legacyGlyph));
  }
});

test("Clock owns its tab while Manager and Harvest keep their routes", () => {
  assert.match(shell, /pathname\.startsWith\("\/clock"\)\) return "clock"/);
  assert.match(shell, /pathname\.startsWith\("\/manage\/day"\)\) return "manager"/);
  assert.doesNotMatch(shell, /return "places"/);
  assert.match(shell, /if \(pathname\.startsWith\("\/harvest"\)\) return "harvest";\s*return "more";/);
});

test("More contains Zone Registry but not the Manager day duplicate", () => {
  assert.match(more, /label: "Zone Registry"/);
  assert.match(more, /href: "\/zones"/);
  assert.match(more, /Beds, rooms, gardens and every canonical farm place/);
  assert.doesNotMatch(more, /label: "Farm day"/);
});

test("the former Zones page identifies itself as Zone Registry and returns to More", () => {
  assert.match(zones, /atlas-phone-title">Zone Registry</);
  assert.match(zones, /href="\/more"/);
  assert.match(zones, />\s*More\s*<\/Link>/);
  assert.match(zones, /aria-label="Atlas Zone Registry"/);
});