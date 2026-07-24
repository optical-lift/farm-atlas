import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("annual landscape sowing cards show biological timing instead of the task due date", () => {
  const source = read("components/atlas/canonical-assigned-task-detail.tsx");

  assert.match(source, /sow_window: "Sow window"/);
  assert.match(source, /first_bloom: "First bloom"/);
  assert.match(source, /display: "Expected display"/);
  assert.match(source, /sow window\|germination\|transplant\|first bloom\|display\|harvest\|clear bed/);
  assert.match(source, /"first bloom": "first_bloom"/);
});
