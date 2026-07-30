import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const home = read("components/atlas/home/AtlasUniversalHomeV2.tsx");
const css = read("components/atlas/home/universal-home-v2.module.css");

test("Home keeps the purple task board immediately before the calendar rail", () => {
  assert.match(home, /<div className=\{styles\.todayStack\}>[\s\S]*<AtlasCard[\s\S]*<HomeTimeRail home=\{home\} \/>/);
  assert.match(css, /\.todayStack[\s\S]*display: grid;[\s\S]*gap: 8px/);
  assert.doesNotMatch(home, /atlas-home-task-hero|atlas-daily-run-sheet/);
});

test("the Home rail keeps the compact first Week Route proportions", () => {
  assert.match(css, /\.days > a[\s\S]*min-height: 56px/);
  assert.match(css, /border-radius: 12px/);
  assert.match(css, /\.days > a strong[\s\S]*font-size: 16px/);
  assert.match(css, /\.days > a em[\s\S]*color: #858bb8/);
  assert.match(home, /weekday: dateFromIso/);
});

test("the rail stays snug and preserves the three time routes", () => {
  assert.match(css, /\.todayStack[\s\S]*gap: 8px/);
  assert.match(home, /Previous week/);
  assert.match(home, /This week · \{weekOpen\}/);
  assert.match(home, /Month ›/);
});
