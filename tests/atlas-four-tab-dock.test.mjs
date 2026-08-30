import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const dock = readFileSync(new URL("../components/atlas/shell/AtlasDock.tsx", import.meta.url), "utf8");
const more = readFileSync(new URL("../app/more/page.tsx", import.meta.url), "utf8");
const zones = readFileSync(new URL("../app/zones/page.tsx", import.meta.url), "utf8");

test("the app dock keeps the universal destinations and adds Clock plus Manager when appropriate", () => {
  for (const label of ["Home", "Work", "Clock", "Harvest", "More"]) {
    assert.match(shell, new RegExp(`label: "${label}"`));
  }
  assert.match(shell, /effectiveFarmRole === "owner" \|\| effectiveFarmRole === "manager"/);
  assert.match(shell, /key: "manager" as const, label: "Manager", href: farmManagerHref/);
  assert.match(shell, /\{ key: "work"[\s\S]*\{ key: "clock"[\s\S]*Manager[\s\S]*\{ key: "harvest"/);
  assert.match(shell, /<AtlasDock items=\{items\} active=\{active\} \/>/);
  assert.match(dock, /gridTemplateColumns: `repeat\(\$\{items\.length\}, minmax\(0, 1fr\)\)`/);
  assert.doesNotMatch(shell, /key: "places"/);
  assert.doesNotMatch(shell, /label: "Places"/);
});

test("dock icons are one custom SVG family including Clock and Manager", () => {
  assert.match(dock, /export type AtlasDockIconKey = "home" \| "work" \| "clock" \| "manager" \| "harvest" \| "more"/);
  assert.match(dock, /if \(kind === "clock"\)/);
  assert.match(dock, /if \(kind === "manager"\)/);
  assert.match(dock, /viewBox: "0 0 24 24"/);
  assert.match(dock, /stroke: "currentColor"/);
  assert.match(dock, /strokeWidth: 1\.9/);
  assert.equal(dock.match(/<svg \{\.\.\.common\}/g)?.length, 6);
  for (const legacyGlyph of ["⌂", "✓", "⌖", "✂", "•••"]) {
    assert.doesNotMatch(dock, new RegExp(legacyGlyph));
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
  assert.match(zones, /atlas-phone-title">Zone Registry/);
  assert.match(zones, /href="\/more"/);
  assert.match(zones, />\s*More\s*<\/Link>/);
  assert.match(zones, /aria-label="Atlas Zone Registry"/);
});
