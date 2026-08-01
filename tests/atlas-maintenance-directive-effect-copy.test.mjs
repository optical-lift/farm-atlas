import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync(new URL("../components/atlas/maintenance-directive-composer.tsx", import.meta.url), "utf8");
const strip = readFileSync(new URL("../components/atlas/maintenance-directive-strip.tsx", import.meta.url), "utf8");

test("clock-effect choices explain their real consequences", () => {
  assert.match(composer, /Bring the card forward only/);
  assert.match(composer, /Count when the target is reached/);
  assert.match(composer, /Count as full maintenance/);
  assert.match(composer, /Inspection only/);
  assert.match(strip, /does not automatically reset/);
  assert.match(strip, /recorded Clear/);
  assert.match(strip, /recorded Mowed fully/);
});
