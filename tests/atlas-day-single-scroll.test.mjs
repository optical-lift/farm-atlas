import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Living Day keeps carry-forward and current work in one document scroll", () => {
  const css = read("app/day-single-scroll.css");
  const layout = read("app/layout.tsx");

  assert.match(layout, /import "\.\/day-single-scroll\.css";/);
  assert.match(css, /\.atlas-day-task-groups/);
  assert.match(css, /\.atlas-day-work-order-list/);
  assert.match(css, /\.atlas-day-route-spine/);
  assert.match(css, /height:\s*auto\s*!important/);
  assert.match(css, /max-height:\s*none\s*!important/);
  assert.match(css, /overflow-y:\s*visible\s*!important/);
  assert.doesNotMatch(css, /overflow-y:\s*(?:auto|scroll)/);
});
