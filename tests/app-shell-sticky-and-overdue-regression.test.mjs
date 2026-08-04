import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const layout = read("app/layout.tsx");
const fixes = read("app/app-shell-regression-fixes.css");
const overdue = read("app/day-overdue-quiet.css");
const day = read("app/day/page.tsx");
const patch = read("app/DayConsequenceTimelinePatch.tsx");

test("the installed Atlas header stays attached to the viewport without overflow ancestors", () => {
  assert.match(layout, /import "\.\/contextual-app-shell\.css";[\s\S]*import "\.\/app-shell-regression-fixes\.css";/);
  assert.match(fixes, /html,[\s\S]*body[\s\S]*overflow-x: clip !important/);
  assert.match(fixes, /\.atlas-phone-shell[\s\S]*overflow-x: clip !important/);
  assert.match(fixes, /\.atlas-phone-top,[\s\S]*position: sticky !important/);
  assert.match(fixes, /top: 0 !important/);
});

test("the drawer is called Overdue while its original Day Route styling remains authoritative", () => {
  assert.match(day, /atlas-day-recovery-count/);
  assert.match(day, /atlas-day-recovery-overview/);
  assert.match(day, /atlas-day-overdue-entry/);
  assert.match(patch, /function applyOverdueCopy/);
  assert.match(patch, /label\.textContent = "Overdue"/);
  assert.match(overdue, /Keep overdue carry-forward readable/);
  assert.match(overdue, /intentionally inherit the original Day Route styling/);
  assert.doesNotMatch(overdue, /\.atlas-day-command-header-with-recovery\s*\{/);
  assert.doesNotMatch(overdue, /\.atlas-day-recovery-overview\s*\{/);
  assert.doesNotMatch(overdue, /\.atlas-day-window-marker\s*\{/);
  assert.doesNotMatch(overdue, /\.atlas-day-mixed-timeline\s+\.atlas-day-overdue-task-card\s*\{/);
});
