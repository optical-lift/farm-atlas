import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const futureMowBridge = read("components/atlas/future-mow-preview-tap-bridge.tsx");
const preview = read("app/mow-preview/page.tsx");
const layout = read("app/layout.tsx");
const day = read("app/day/page.tsx");
const dayCss = read("app/day-route-v1-refine.css");
const headerCss = read("app/global-atlas-header.css");
const appShellCss = read("app/app-shell-regression-fixes.css");
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

test("future Clock mowing slots are tappable without pretending they already have task UUIDs", () => {
  assert.match(layout, /<FutureMowPreviewTapBridge \/>/);
  assert.match(futureMowBridge, /atlas-day-future-plan-card\[data-future-projection-source='rhythm'\]/);
  assert.match(futureMowBridge, /\/mow-preview\?date=/);
  assert.match(dayCss, /atlas-day-future-plan-card\[data-future-projection-source="rhythm"\]/);
  assert.match(dayCss, /pointer-events: auto !important/);
  assert.match(preview, /data-atlas-mow-preview="true"/);
  assert.match(preview, /Planning preview/);
  assert.match(preview, /rhythm_rules/);
  assert.match(preview, /completion=\{false\}/);
});

test("future-day command header keeps a complete purple capsule", () => {
  assert.match(day, /atlas-day-command-topline/);
  assert.match(day, /atlas-day-command-date/);
  assert.match(day, /<ViewToggle viewMode=\{viewMode\}/);
  assert.match(dayCss, /atlas-day-command-header:has\(> \.atlas-day-command-topline:last-child\)/);
  assert.match(dayCss, /padding-bottom: 11px !important/);
});

test("global Atlas header is the sole visible application header and wins over the older sticky guard", () => {
  assert.match(frame, /className="atlas-global-header"/);
  assert.match(frame, /\/api\/atlas\/weather/);
  assert.match(frame, /aria-label="Document work"/);
  assert.match(appShellCss, /\.atlas-topbar,[\s\S]*position: sticky !important/);
  assert.ok(layout.indexOf('import "./global-atlas-header.css";') > layout.indexOf('import "./app-shell-regression-fixes.css";'));
  assert.match(headerCss, /\.atlas-global-header/);
  assert.match(headerCss, /position: fixed !important/);
  assert.match(headerCss, /box-sizing: border-box !important/);
  assert.match(headerCss, /height: calc\(var\(--atlas-context-header-height\) \+ env\(safe-area-inset-top\)\) !important/);
  assert.match(headerCss, /\.atlas-phone-top:not\(\.atlas-global-header\)/);
  assert.match(headerCss, /display: none !important/);
  assert.match(headerCss, /grid-template-rows: minmax\(0, 1fr\) !important/);
});
