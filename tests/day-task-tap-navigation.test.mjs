import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const surface = read("app/day/DaySurface.tsx");
const layout = read("app/day/layout.tsx");

test("Day task body taps open canonical Task Focus while the caret keeps drawer behavior", () => {
  assert.match(surface, /\.atlas-journal-task-row > summary/);
  assert.match(surface, /target\.closest\("\.atlas-journal-row-caret"\)/);
  assert.match(surface, /\/task-focus\/\$\{encodeURIComponent\(taskId\)\}/);
  assert.match(surface, /returnTo=\$\{encodeURIComponent\(returnTo\)\}/);
  assert.match(surface, /event\.preventDefault\(\)/);
  assert.match(surface, /event\.stopPropagation\(\)/);
  assert.match(surface, /router\.push\(href\)/);
});

test("the navigation surface is scoped to the Day route instead of RootLayout", () => {
  assert.match(layout, /<DaySurface>\{children\}<\/DaySurface>/);
  assert.doesNotMatch(read("app/layout.tsx"), /DaySurface/);
  assert.match(surface, /onClickCapture=\{onClick\}/);
  assert.match(surface, /onKeyDownCapture=\{onKeyDown\}/);
});
