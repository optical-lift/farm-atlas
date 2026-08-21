import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const day = read("app/day/page.tsx");
const dayCss = read("app/day-route-v1-refine.css");
const headerCss = read("app/global-atlas-header.css");
const taskFocus = read("app/task-focus/[taskId]/page.tsx");

test("Day task text opens Task Focus while the route dot remains completion", () => {
  assert.match(frame, /if \(!pathname\.startsWith\("\/day"\)\) return/);
  assert.match(frame, /details\.atlas-day-task-card > summary/);
  assert.match(frame, /DAY_TASK_ID/);
  assert.match(frame, /event\.preventDefault\(\)/);
  assert.match(frame, /window\.location\.assign\(`\/task-focus\//);
  assert.match(day, /className=\{`atlas-day-task-node/);
  assert.match(day, /onClick=\{\(\) => onNodePress\(task\)\}/);
  assert.match(day, /href=\{taskHref\(task, returnTo\)\}/);
});

test("Mow Task Focus routing stays exact to Clock-governed mowing cards", () => {
  assert.match(taskFocus, /task\.task_type === "mowing"/);
  assert.match(taskFocus, /task_style\) === "mowing_round"/);
  assert.match(taskFocus, /truthy\(task\.metadata\?\.clock_managed\)/);
  assert.match(taskFocus, /return <MowingFocusPage/);
});

test("future-day command header keeps a complete purple capsule", () => {
  assert.match(day, /atlas-day-command-topline/);
  assert.match(day, /atlas-day-command-date/);
  assert.match(day, /<ViewToggle viewMode=\{viewMode\}/);
  assert.match(dayCss, /atlas-day-command-header:has\(> \.atlas-day-command-topline:last-child\)/);
  assert.match(dayCss, /padding-bottom: 11px !important/);
});

test("global Atlas header is the sole visible application header", () => {
  assert.match(frame, /className="atlas-global-header"/);
  assert.match(frame, /\/api\/atlas\/weather/);
  assert.match(frame, /aria-label="Document work"/);
  assert.match(headerCss, /\.atlas-global-header/);
  assert.match(headerCss, /inset: 0 0 auto !important/);
  assert.match(headerCss, /\.atlas-phone-top:not\(\.atlas-global-header\)/);
  assert.match(headerCss, /display: none !important/);
  assert.match(headerCss, /grid-template-rows: minmax\(0, 1fr\) !important/);
});
