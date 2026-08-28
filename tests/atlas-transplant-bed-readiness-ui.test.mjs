import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dayRoute = readFileSync(new URL("../lib/atlas/day-route.ts", import.meta.url), "utf8");
const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");
const readiness = readFileSync(new URL("../lib/atlas/worker-readiness.ts", import.meta.url), "utf8");

test("Worker Day keeps blocked planting work visible while naming the bed gate", () => {
  assert.match(dayPage, /task\.status === "open" \|\| task\.status === "blocked"/);
  assert.match(dayRoute, /execution_lock_kind/);
  assert.match(dayRoute, /bed_weeding/);
  assert.match(dayRoute, /Locked · weed/);
});

test("urgent weed cards expose the downstream planting pressure", () => {
  assert.match(dayRoute, /bed_readiness_deadline_pressure/);
  assert.match(dayRoute, /blocking_task_count/);
  assert.match(dayRoute, /Blocks \$\{blockingCount\}/);
  assert.match(dayRoute, /blocking_due_now/);
});

test("task focus explains why a due transplant cannot execute yet", () => {
  assert.match(readiness, /bedReadinessReady === false/);
  assert.match(readiness, /Bed not ready/);
  assert.match(readiness, /before transplanting/);
  assert.match(readiness, /planting window is here/);
});
