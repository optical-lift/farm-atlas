import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day keeps the mobile completion target invisible around each visible dot", () => {
  const layout = read("app/layout.tsx");
  const css = read("app/day-node-clean.css");

  assert.match(layout, /import "\.\/day-node-clean\.css"/);
  assert.ok(
    layout.indexOf('import "./day-node-clean.css"') > layout.indexOf('import "./farm-conditions-merged.css"'),
    "the dot cleanup must load after the remaining global Day styles",
  );

  assert.match(css, /\.atlas-day-route-spine \.atlas-day-task-entry/);
  assert.match(css, /\.atlas-day-route-spine \.atlas-day-task-node/);
  assert.match(css, /background: transparent !important/);
  assert.match(css, /background-image: none !important/);
  assert.match(css, /box-shadow: none !important/);
  assert.match(css, /clip-path: none !important/);
  assert.match(css, /mask: none !important/);
  assert.match(css, /content: none !important/);
});

test("the cleanup preserves the small dot and its full touch target", () => {
  const base = read("app/day-timeline-completion-echo.css");
  const css = read("app/day-node-clean.css");

  assert.match(base, /width: 36px;[\s\S]*height: 36px;/);
  assert.match(base, /\.atlas-day-task-node > span/);
  assert.doesNotMatch(css, /\.atlas-day-task-node\s*>\s*span[\s\S]{0,120}display:\s*none/);
  assert.doesNotMatch(css, /\.atlas-day-task-node\s*>\s*span[\s\S]{0,120}visibility:\s*hidden/);
});
