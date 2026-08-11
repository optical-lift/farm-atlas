import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const bridge = read("app/day/DayTaskOpenBridge.tsx");
const layout = read("app/day/layout.tsx");

test("Day task body taps open canonical Task Focus while the caret keeps drawer behavior", () => {
  assert.match(bridge, /\.atlas-journal-task-row > summary/);
  assert.match(bridge, /target\.closest\("\.atlas-journal-row-caret"\)/);
  assert.match(bridge, /\/task-focus\/\$\{encodeURIComponent\(taskId\)\}/);
  assert.match(bridge, /returnTo=\$\{encodeURIComponent\(returnTo\)\}/);
  assert.match(bridge, /event\.preventDefault\(\)/);
  assert.match(bridge, /event\.stopPropagation\(\)/);
});

test("the navigation bridge is scoped to the Day route instead of RootLayout", () => {
  assert.match(layout, /<DayTaskOpenBridge \/>/);
  assert.doesNotMatch(read("app/layout.tsx"), /DayTaskOpenBridge/);
});
