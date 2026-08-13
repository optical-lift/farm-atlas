import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(new URL("../app/task-focus/[taskId]/layout.tsx", import.meta.url), "utf8");

test("Task Focus does not mount its own full-screen cue delivery", () => {
  assert.doesNotMatch(layout, /TaskFocusCueDelivery/);
});
