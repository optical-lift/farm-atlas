import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day removes every legacy paint layer around each timeline dot", () => {
  const layout = read("app/layout.tsx");
  const css = read("app/day-node-clean.css");

  assert.match(layout, /import "\.\/day-node-clean\.css"/);
  assert.ok(
    layout.indexOf('import "./day-node-clean.css"') > layout.indexOf('import "./farm-conditions-merged.css"'),
    "the dot cleanup must load after the remaining global Day styles",
  );

  assert.match(css, /> \.atlas-day-task-entry/);
  assert.match(css, /> \.atlas-day-task-entry > \.atlas-day-task-card::before/);
  assert.match(css, /> \.atlas-day-task-entry > \.atlas-day-task-node/);
  assert.match(css, /> \.atlas-day-task-entry > \.atlas-day-task-node > span/);
  assert.match(css, /> \.atlas-day-task-node > span::before/);
  assert.match(css, /background: transparent !important/);
  assert.match(css, /background-image: none !important/);
  assert.match(css, /box-shadow: none !important/);
  assert.match(css, /clip-path: none !important/);
  assert.match(css, /mask: none !important/);
  assert.match(css, /content: none !important/);
});

test("the cleanup preserves one small dot inside the full mobile touch target", () => {
  const base = read("app/day-timeline-completion-echo.css");
  const css = read("app/day-node-clean.css");

  assert.match(base, /width: 36px;[\s\S]*height: 36px;/);
  assert.match(css, /The only painted part of the 36px control is this small status dot/);
  assert.match(css, /width: 11px !important;[\s\S]*height: 11px !important;/);
  assert.match(css, /atlas-day-route-current[\s\S]*width: 13px !important/);
  assert.match(css, /atlas-day-route-care[\s\S]*width: 7px !important/);
  assert.match(css, /atlas-day-route-blocked[\s\S]*border-style: dashed !important/);
  assert.doesNotMatch(css, /\.atlas-day-task-node\s*>\s*span[\s\S]{0,160}visibility:\s*hidden/);
});
