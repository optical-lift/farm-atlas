import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const layout = read("app/layout.tsx");
const fixes = read("app/app-shell-regression-fixes.css");
const recovery = read("app/day-overdue-quiet.css");
const day = read("app/day/page.tsx");

test("the installed Atlas header stays attached to the viewport without overflow ancestors", () => {
  assert.match(layout, /import "\.\/contextual-app-shell\.css";[\s\S]*import "\.\/app-shell-regression-fixes\.css";/);
  assert.match(fixes, /html,[\s\S]*body[\s\S]*overflow-x: clip !important/);
  assert.match(fixes, /\.atlas-phone-shell[\s\S]*overflow-x: clip !important/);
  assert.match(fixes, /\.atlas-phone-top,[\s\S]*position: sticky !important/);
  assert.match(fixes, /top: 0 !important/);
});

test("the recovery drawer carries the warning while overdue task rows stay readable", () => {
  assert.match(day, /atlas-day-recovery-count/);
  assert.match(day, /atlas-day-recovery-overview/);
  assert.match(day, /atlas-day-overdue-entry/);
  assert.doesNotMatch(day, /atlas-day-overdue-badge/);
  assert.match(recovery, /\.atlas-day-mixed-timeline \.atlas-day-overdue-badge/);
  assert.match(recovery, /\.atlas-day-mixed-timeline \.atlas-day-consequence-kicker/);
  assert.match(recovery, /display: none !important/);
  assert.match(recovery, /atlas-day-overdue-task-card[\s\S]*padding: 8px 4px 18px 10px !important/);
  assert.match(recovery, /background: transparent !important/);
});
