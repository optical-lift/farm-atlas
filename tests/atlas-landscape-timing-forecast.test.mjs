import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("annual landscape sowing cards keep biological timing in the Dominion card", () => {
  const source = read("components/atlas/dominion-assigned-task-detail.tsx");

  assert.match(source, /"sow window": "Sow window"/);
  assert.match(source, /"first bloom": "First bloom"/);
  assert.match(source, /display: "Expected display"/);
  assert.match(source, /sow window\|germination\|transplant\|first bloom\|display\|harvest\|clear bed/);
  assert.match(source, /<strong>Timing forecast<\/strong>/);
  assert.match(source, /timing\.facts\.map/);
});
