import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../lib/atlas/farm-day.ts", import.meta.url), "utf8");

test("Atlas has one explicit farm timezone authority", () => {
  assert.match(source, /DEFAULT_ATLAS_FARM_TIME_ZONE = "America\/Chicago"/);
  assert.match(source, /atlasFarmDateIso/);
  assert.match(source, /atlasShiftFarmDate/);
  assert.match(source, /atlasFarmWeekWindow/);
  assert.match(source, /atlasFarmMonthEnd/);
});

test("farm date arithmetic is calendar based rather than browser-offset based", () => {
  assert.match(source, /setUTCDate/);
  assert.doesNotMatch(source, /getTimezoneOffset/);
});
