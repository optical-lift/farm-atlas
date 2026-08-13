import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cue = readFileSync(new URL("../app/GlobalDayCueDelivery.tsx", import.meta.url), "utf8");

test("global cue still opens the canonical task and leaves Task Focus cue-free", () => {
  assert.match(cue, /router\.push\(`\/task-focus\/\$\{taskId\}/);
  assert.match(cue, /resolveCue\(\{ opened: "true" \}\)/);
});
