import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const layout = read("app/layout.tsx");
const fixes = read("app/app-shell-regression-fixes.css");
const overdue = read("app/day-overdue-quiet.css");
const day = read("app/day/page.tsx");

test("the installed Atlas header stays attached to the viewport without overflow ancestors", () => {
  assert.match(layout, /import "\.\/contextual-app-shell\.css";[\s\S]*import "\.\/app-shell-regression-fixes\.css";/);
  assert.match(fixes, /html,[\s\S]*body[\s\S]*overflow-x: clip !important/);
  assert.match(fixes, /\.atlas-phone-shell[\s\S]*overflow-x: clip !important/);
  assert.match(fixes, /\.atlas-phone-top,[\s\S]*position: sticky !important/);
  assert.match(fixes, /top: 0 !important/);
});

test("the overdue drawer copy and compact geometry are owned by the Day surface", () => {
  assert.equal(existsSync(new URL("../app/DayConsequenceTimelinePatch.tsx", import.meta.url)), false);
  assert.doesNotMatch(layout, /DayConsequenceTimelinePatch/);
  assert.match(day, /atlas-day-recovery-count/);
  assert.match(day, /atlas-day-recovery-overview/);
  assert.match(day, /atlas-day-overdue-entry/);
  assert.match(overdue, /exact compact Day Route geometry/);
  assert.match(overdue, /\.atlas-day-recovery-count[\s\S]*border-radius: 999px/);
  assert.match(overdue, /\.atlas-day-recovery-count::after[\s\S]*content: "Overdue"/);
  assert.match(overdue, /\.atlas-day-recovery-summary-copy > span[\s\S]*display: none/);
  assert.match(overdue, /\.atlas-day-window-marker/);
  assert.match(overdue, /\.atlas-day-mixed-timeline \.atlas-day-overdue-task-card/);
  assert.doesNotMatch(overdue, /\.atlas-day-command-header-with-recovery\s*\{/);
});
