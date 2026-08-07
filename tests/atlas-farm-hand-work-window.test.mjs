import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync(new URL("../lib/atlas/farm-hand-conveyor-window.ts", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");

test("farm-hand conveyor holds outdoor work through the hot middle of the day", () => {
  assert.match(helper, /FARM_HAND_OUTDOOR_MORNING_END_HOUR = 11/);
  assert.match(helper, /FARM_HAND_OUTDOOR_EVENING_START_HOUR = 19/);
  assert.match(helper, /America\/Chicago/);
  assert.match(helper, /Outside work resumes at 7pm/);
  assert.match(helper, /available = home\.moves\.filter/);
});

test("explicit indoor and outdoor metadata override location inference", () => {
  assert.match(helper, /work_environment/);
  assert.match(helper, /covered_indoor/);
  assert.match(helper, /\["outdoor", "outside", "field"\]/);
  assert.match(helper, /INDOOR_TERMS/);
  assert.match(helper, /OUTDOOR_TERMS/);
});

test("Home applies the work window only to the farm-hand conveyor", () => {
  assert.match(home, /renderedFarmHandMode\s*\?\s*\{/);
  assert.match(home, /atlasFarmHandConveyorMoves\(unconstrainedRenderedHome\)/);
  assert.match(agents, /hold outdoor work from 11:00 a\.m\. until 7:00 p\.m\. Central/);
});
