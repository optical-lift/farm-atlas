import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const task = readFileSync(new URL("../app/task-focus/[taskId]/layout.tsx", import.meta.url), "utf8");

test("cue ownership lives at app root only", () => {
  assert.match(root, /GlobalDayCueDelivery/);
  assert.doesNotMatch(task, /CueDelivery/);
});
