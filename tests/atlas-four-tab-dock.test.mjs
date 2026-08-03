import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const more = readFileSync(new URL("../app/more/page.tsx", import.meta.url), "utf8");
const zones = readFileSync(new URL("../app/zones/page.tsx", import.meta.url), "utf8");

test("the app dock has exactly four permanent destinations", () => {
  for (const label of ["Home", "Work", "Harvest", "More"]) {
    assert.match(shell, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(shell, /key: "places"/);
  assert.doesNotMatch(shell, /label: "Places"/);
  assert.match(shell, /gridTemplateColumns: "repeat\(4, minmax\(0, 1fr\)\)"/);
});

test("the four dock icons are one custom SVG family", () => {
  assert.match(shell, /type DockIconKey = "home" \| "work" \| "harvest" \| "more"/);
  assert.match(shell, /viewBox: "0 0 24 24"/);
  assert.match(shell, /stroke: "currentColor"/);
  assert.match(shell, /strokeWidth: 1\.9/);
  assert.equal(shell.match(/<svg \{\.\.\.common\}/g)?.length, 4);
  for (const legacyGlyph of ["⌂", "✓", "⌖", "✂", "•••"]) {
    assert.doesNotMatch(shell, new RegExp(legacyGlyph));
  }
});

test("zone and object routes belong to More instead of a removed Places tab", () => {
  assert.doesNotMatch(shell, /return "places"/);
  assert.match(shell, /if \(pathname\.startsWith\("\/harvest"\)\) return "harvest";\s*return "more";/);
});

test("More now contains the Zone Registry destination", () => {
  assert.match(more, /label: "Zone Registry"/);
  assert.match(more, /href: "\/zones"/);
  assert.match(more, /Beds, rooms, gardens and every canonical farm place/);
});

test("the former Zones page identifies itself as Zone Registry and returns to More", () => {
  assert.match(zones, /atlas-phone-title">Zone Registry</);
  assert.match(zones, /href="\/more"/);
  assert.match(zones, />More<\/Link>/);
  assert.match(zones, /aria-label="Atlas Zone Registry"/);
});
