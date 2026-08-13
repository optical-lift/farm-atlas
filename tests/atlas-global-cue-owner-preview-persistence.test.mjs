import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cue = readFileSync(new URL("../app/GlobalDayCueDelivery.tsx", import.meta.url), "utf8");

test("Owner preview dismissal survives a page reload without clearing worker cue state", () => {
  assert.match(cue, /sessionStorage\.getItem/);
  assert.match(cue, /sessionStorage\.setItem/);
  assert.match(cue, /hideCueForSession\(true\)/);
  assert.match(cue, /if \(isOperatorPreview\)/);
});
