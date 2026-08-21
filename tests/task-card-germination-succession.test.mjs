import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/task-focus/[taskId]/page.tsx");
const germination = read("app/task-focus/[taskId]/GerminationFocusPage.tsx");

test("germination succession is resolved from production truth before first render", () => {
  assert.match(page, /from\("production_successions"\)/);
  assert.match(page, /\.eq\("crop_cycle_id", resolvedCycleId\)/);
  assert.match(page, /\.contains\("metadata", \{ crop_cycle_ids: \[resolvedCycleId\] \}\)/);
  assert.match(page, /successionNumber: crop\.successionNumber/);
});

test("Germination card labels the canonical succession in the top-right family detail", () => {
  assert.match(germination, /const successionNumber = task\.successionNumber \?\? null/);
  assert.match(germination, /familyDetail=\{successionNumber \? `Succession \$\{successionNumber\}` : undefined\}/);
});

test("Germination no longer waits for a client GET to discover succession", () => {
  assert.doesNotMatch(germination, /useEffect/);
  assert.doesNotMatch(germination, /germination-check\?taskId/);
  assert.doesNotMatch(germination, /setSuccessionNumber/);
});
