import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function exists(path) {
  return existsSync(new URL(`../${path}`, import.meta.url));
}

const layout = read("app/day/layout.tsx");
const surface = read("app/day/DaySurface.tsx");

test("Day owns task-row navigation without a document event bridge", () => {
  assert.equal(exists("app/day/DayTaskOpenBridge.tsx"), false);
  assert.match(layout, /<DaySurface>\{children\}<\/DaySurface>/);
  assert.doesNotMatch(layout, /DayTaskOpenBridge/);
  assert.match(surface, /data-atlas-day-surface="true"/);
  assert.match(surface, /onClickCapture=\{onClick\}/);
  assert.match(surface, /onKeyDownCapture=\{onKeyDown\}/);
  assert.match(surface, /router\.push\(href\)/);
  assert.match(surface, /atlas-journal-row-caret/);
  assert.doesNotMatch(surface, /document\.addEventListener/);
  assert.doesNotMatch(surface, /MutationObserver/);
});
