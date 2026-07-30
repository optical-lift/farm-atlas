import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/page.tsx");
const home = read("components/atlas/home/AtlasUniversalHomeV2.tsx");
const css = read("components/atlas/home/universal-home-v2.module.css");
const build = `${page}\n${home}\n${css}`;

test("Home uses the compact day rail instead of large Week and Month dashboard cards", () => {
  assert.match(page, /AtlasUniversalHomeV2/);
  assert.match(home, /HomeTimeRail/);
  assert.match(home, /Previous week/);
  assert.match(home, /This week/);
  assert.match(home, /Month/);
  assert.doesNotMatch(home, /UniversalOverviewBoxes|atlas-home-overview-card/);
  assert.doesNotMatch(home, />The week</);
});

test("every day in the current Monday-through-Sunday rail opens its Living Day", () => {
  assert.match(home, /weekStartMonday/);
  assert.match(home, /Array\.from\(\{ length: 7 \}/);
  assert.match(home, /\/day\?date=/);
  assert.match(home, /aria-current=\{day\.dateIso === todayIso \? "date"/);
  assert.match(css, /grid-template-columns: repeat\(7/);
  assert.match(home, /data-atlas-home-time-rail="true"/);
});

test("Home is a prepared task cover followed by Needs you and the farms", () => {
  assert.match(home, /Today at/);
  assert.match(home, /dealt with/);
  assert.match(home, /carry forward/);
  assert.match(home, /Needs you/);
  assert.match(home, /The farms/);
  assert.match(home, /days to frost/);
  assert.doesNotMatch(home, /Farm pulse|known gaps|Moving now|AtlasPortfolioMatrix|AtlasTrailPulseBoard|Work in Motion|Current moves/);
});

test("the farm section shows every visible farm through physical and seasonal measures", () => {
  assert.match(home, /home\.farms\.map/);
  assert.match(home, /beds growing/);
  assert.match(home, /sq ft active/);
  assert.match(home, /stems this year/);
  assert.match(home, /sowings recorded this year/);
  assert.match(home, /FIRST_KILLING_FREEZE_DAY = 1/);
  assert.match(home, /FIRST_KILLING_FREEZE_MONTH_INDEX = 10/);
  assert.match(css, /\.farmCards[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.farmCards[\s\S]*grid-template-columns: 1fr/);
});

test("broad open-work and project-movement totals no longer dominate Home", () => {
  assert.doesNotMatch(home, /home\.metrics\.openWorkCount/);
  assert.doesNotMatch(home, /projects moving/);
  assert.doesNotMatch(home, /home\.metrics\.attentionCount/);
  assert.doesNotMatch(home, /home\.metrics\.farmCount/);
});

test("the compact home remains inside the sticky Atlas app shell", () => {
  assert.match(home, /<AtlasAppShell/);
  assert.match(home, /<AtlasTopBar/);
  assert.match(css, /padding: 10px 11px calc\(18px \+ var\(--atlas-context-footer-height\)\)/);
  assert.match(build, /atlas-note-plus/);
  assert.match(build, /data-atlas-home-task-board="true"/);
});
