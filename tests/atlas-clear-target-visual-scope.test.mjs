import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

// Presentation-only guard: crop identity owns the Clear warning.
test("selected-crop Clear communicates scope through the crop row instead of warning prose", () => {
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const targetStyles = read("components/atlas/weed-card-clear-target.module.css");

  assert.match(focus, /clearMode \? "Terminate now" : "Bed now"/);
  assert.match(focus, /clearMode \? selectedCrop : card\.mainCropLabel/);
  assert.match(focus, /target && clearMode \? targetStyles\.terminateCropRow : ""/);
  assert.match(focus, /target && clearMode \? "TERMINATE" : titleCase\(cohort\.lifeCycle\)/);
  assert.match(focus, /data-bed-work-target=\{target \? "true" : "false"\}/);

  assert.doesNotMatch(focus, /Termination target/);
  assert.doesNotMatch(focus, /is ready for termination\./);
  assert.doesNotMatch(focus, /Partial bed clearing/);
  assert.doesNotMatch(focus, /There are still active crops remaining in this bed\./);
  assert.doesNotMatch(focus, /Do not clear the whole bed/);

  assert.match(targetStyles, /\.terminateCropRow/);
  assert.match(targetStyles, /background:/);
  assert.match(targetStyles, /box-shadow:/);
});
