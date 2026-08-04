import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const more = readFileSync(new URL("../app/more/page.tsx", import.meta.url), "utf8");
const zones = readFileSync(new URL("../app/zones/page.tsx", import.meta.url), "utf8");

test("the app dock keeps four universal destinations and adds Manager only for management", () => {
  for (const label of ["Home", "Work", "Harvest", "More"]) {
    assert.match(shell, new RegExp(`label: "${label}"`));
  }
  assert.match(shell, /effectiveFarmRole === "owner" \|\| effectiveFarmRole === "manager"/);
  assert.match(shell, /key: "manager" as const, label: "Manager", href: farmManagerHref/);
  assert.match(shell, /\{ key: "work"[\s\S]*Manager[\s\S]*\{ key: "harvest"/);
  assert.match(shell, /gridTemplateColumns: `repeat\(\$\{items\.length\}, minmax\(0, 1fr\)\)`/);
  assert.doesNotMatch(shell, /key: "places"/);
  assert.doesNotMatch(shell, /label: "Places"/);
});

test("dock icons are one custom SVG family including Manager", () => {
  assert.match(shell, /type DockIconKey = "home" \| "work" \| "manager" \| "harvest" \| "more"/);
  assert.match(shell, /if \(kind === "manager"\)/);
  assert.match(shell, /viewBox: "0 0 24 24"/);
  assert.match(shell, /stroke: "currentColor"/);
  assert.match(shell, /strokeWidth: 1\.9/);
  assert.equal(shell.match(/<svg \{\.\.\.common\}/g)?.length, 5);
  for (const legacyGlyph of ["⌂", "✓", "⌖", "✂", "•••"]) {
    assert.doesNotMatch(shell, new RegExp(legacyGlyph));
  }
});

test("Manager owns its route while zone and object routes belong to More", () => {
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
