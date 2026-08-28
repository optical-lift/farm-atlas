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

test("downstream transplant consequence stays off the Day-feed cue pills", () => {
  assert.doesNotMatch(dayRoute, /Your plants are waiting:/);
  assert.doesNotMatch(dayRoute, /This bed is holding them up/);
  assert.doesNotMatch(dayRoute, /weed job.*scheduled later/);
  assert.doesNotMatch(dayRoute, /Next: \$\{unlocksTask\}/);
  assert.match(dayRoute, /Downstream consequence belongs to the task dependency rail/);
});

test("task focus explains why a due transplant cannot execute yet", () => {
  assert.match(readiness, /bedReadinessReady === false/);
  assert.match(readiness, /Bed not ready/);
  assert.match(readiness, /before transplanting/);
  assert.match(readiness, /planting window is here/);
});
