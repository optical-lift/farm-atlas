import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const home = read("components/atlas/home/AtlasUniversalHomeV2.tsx");
const guards = read("app/app-shell-regression-fixes.css");

test("Home keeps the purple hero before the calendar rail", () => {
  assert.match(home, /<AtlasCard[\s\S]*atlas-home-task-hero[\s\S]*<HomeTimeRail home=\{home\} \/>/);
  assert.match(guards, /atlas-home-task-hero\.atlas-daily-run-sheet[\s\S]*order: -20 !important/);
  assert.match(guards, /atlas-home-task-hero\.atlas-daily-run-sheet \+ section[\s\S]*order: -19 !important/);
});

test("the Home rail restores the compact first Week Route proportions", () => {
  assert.match(guards, /min-width: 48px !important/);
  assert.match(guards, /border-radius: 13px !important/);
  assert.match(guards, /font-size: 15px !important/);
  assert.match(guards, /background: transparent !important;[\s\S]*color: #858bb8 !important/);
  assert.match(guards, /content: "Mon"/);
  assert.match(guards, /content: "Sun"/);
});

test("the rail stays snug and preserves the three time routes", () => {
  assert.match(guards, /margin-top: -7px !important/);
  assert.match(home, /Previous week/);
  assert.match(home, /This week · \{weekOpen\}/);
  assert.match(home, /Month ›/);
});
