import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const operationalGlobals = readFileSync(new URL("../components/atlas/shell/AtlasOperationalProjectionGlobals.tsx", import.meta.url), "utf8");
const task = readFileSync(new URL("../app/task-focus/[taskId]/layout.tsx", import.meta.url), "utf8");

test("cue ownership lives at the universal operational app shell only", () => {
  assert.match(root, /AtlasOperationalProjectionGlobals/);
  assert.match(operationalGlobals, /GlobalDayCueDelivery/);
  assert.match(operationalGlobals, /if \(isPrincipalProjection\(pathname\)\) return null/);
  assert.doesNotMatch(task, /CueDelivery/);
});
