import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const strip = readFileSync(new URL("../components/atlas/maintenance-directive-strip.tsx", import.meta.url), "utf8");

test("maintenance card shows temporary instructions without replacing result controls", () => {
  assert.match(strip, /Attached maintenance instructions/);
  assert.match(strip, /Owner instruction/);
  assert.match(strip, /Instruction checklist/);
  assert.doesNotMatch(strip, /markClear|mowed_full|postAtlasWeedCardSession/);
});
