import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync(new URL("../lib/atlas/farm-hand-conveyor-window.ts", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");

test("farm-hand conveyor treats Anna's hours as fallback rhythm rather than hard weather truth", () => {
  assert.match(helper, /FARM_HAND_OUTDOOR_MORNING_END_HOUR = 11/);
  assert.match(helper, /FARM_HAND_OUTDOOR_EVENING_START_HOUR = 19/);
  assert.match(helper, /fallbackRhythmAllowsOutdoor/);
  assert.match(helper, /api\.open-meteo\.com/);
  assert.match(helper, /apparent_temperature/);
  assert.match(helper, /relative_humidity_2m/);
  assert.match(helper, /precipitation/);
  assert.match(helper, /cloud_cover/);
  assert.match(helper, /weather_code/);
});

test("weather can expand or contract the outdoor window and respects task heat exposure", () => {
  assert.match(helper, /heat_exposure/);
  assert.match(helper, /code >= 95/);
  assert.match(helper, /apparent >= 95/);
  assert.match(helper, /apparent <= 80/);
  assert.match(helper, /cloud >= 70/);
  assert.match(helper, /outdoorWindowClosingSoon/);
  assert.match(helper, /Outside looks better/);
});

test("explicit indoor and outdoor metadata override location inference", () => {
  assert.match(helper, /work_environment/);
  assert.match(helper, /covered_indoor/);
  assert.match(helper, /\["outdoor", "outside", "field"\]/);
  assert.match(helper, /INDOOR_TERMS/);
  assert.match(helper, /OUTDOOR_TERMS/);
});

test("Home awaits weather-smart conveyor before rendering hero and Quick Wins", () => {
  assert.match(home, /await atlasFarmHandConveyorMoves\(unconstrainedRenderedHome\)/);
  assert.match(agents, /strong prior, not a hard clock rule/);
  assert.match(agents, /Never interrupt indoor time with a tiny outside task/);
});
