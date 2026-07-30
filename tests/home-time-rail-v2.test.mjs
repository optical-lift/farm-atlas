import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/page.tsx");
const home = read("components/atlas/home/AtlasUniversalHomeV2.tsx");
const css = read("components/atlas/home/universal-home-v2.module.css");
const taskCss = read("app/home-task-overview.css");

const build = `${page}\n${home}\n${css}\n${taskCss}`;

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
});

test("Home is a prepared task cover followed by Needs you and Farm pulse", () => {
  assert.match(home, /Today at/);
  assert.match(home, /dealt with/);
  assert.match(home, /carry forward/);
  assert.match(home, /Needs you/);
  assert.match(home, /Farm pulse/);
  assert.match(home, /known gaps/);
  assert.doesNotMatch(home, /Moving now|AtlasPortfolioMatrix|AtlasTrailPulseBoard|Work in Motion|Current moves/);
});

test("broad open-work and project-movement totals no longer dominate Home", () => {
  assert.doesNotMatch(home, /home\.metrics\.openWorkCount/);
  assert.doesNotMatch(home, /projects moving/);
  assert.match(home, /today/);
  assert.match(home, /carried/);
  assert.match(home, /home\.metrics\.farmCount/);
});

test("the compact home remains inside the sticky Atlas app shell", () => {
  assert.match(home, /<AtlasAppShell/);
  assert.match(home, /<AtlasTopBar/);
  assert.match(css, /padding: 10px 11px calc\(18px \+ var\(--atlas-context-footer-height\)\)/);
  assert.match(build, /atlas-note-plus/);
  assert.match(build, /atlas-home-task-overview/);
});
