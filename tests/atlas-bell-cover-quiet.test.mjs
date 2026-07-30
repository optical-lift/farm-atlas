import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const css = read("app/bell-cover-quiet.css");
const layout = read("app/layout.tsx");

test("the journal-cover Bell reads as a quiet edge notice instead of a sticky note", () => {
  assert.match(layout, /import "\.\/bell-cover-quiet\.css"/);
  assert.match(css, /background: rgba\(247, 244, 233, 0\.97\)/);
  assert.match(css, /border-radius: 14px 0 0 14px/);
  assert.match(css, /transform: none/);
  assert.match(css, /\.atlas-while-away-slip > em[\s\S]*display: none/);
  assert.doesNotMatch(css, /#fff8c8|rotate\(/i);
});
