import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Farm Conditions keeps gauge observations separate from area estimates and forecasts", () => {
  const api = read("app/api/atlas/farm-weather-rain/route.ts");
  const panel = read("components/atlas/home/FarmConditionsPanel.tsx");

  assert.match(api, /farm_rain_observations/);
  assert.match(api, /sourceType:\s*"area_model_estimate"/);
  assert.match(api, /areaEstimate:/);
  assert.match(api, /forecast:/);
  assert.match(panel, /weather-model rainfall readings/);
  assert.match(panel, /Use this farm’s physical gauge/);
});

test("Farm Conditions reads measured Moon state from the canonical Atlas sky ledger", () => {
  const skyApi = read("app/api/atlas/sky-state/route.ts");
  const panel = read("components/atlas/home/FarmConditionsPanel.tsx");

  assert.match(skyApi, /\.rpc\("sky_state_at_v2"/);
  assert.match(skyApi, /\.rpc\("sky_ledger_status_v1"/);
  assert.match(skyApi, /canonical_atlas_sky_ledger/);
  assert.match(skyApi, /taskGuidanceIncluded:\s*false/);
  assert.match(panel, /\/api\/atlas\/sky-state\?farmId=/);
  assert.match(panel, /This is the factual Atlas sky ledger only/);
  assert.match(panel, /No task guidance is produced by this panel/);
});

test("Home no longer invokes the legacy almanac task-scoring route", () => {
  const allApi = read("app/api/atlas/farm-conditions/all/route.ts");
  const legacyRoute = read("app/api/atlas/farm-conditions/route.ts");
  const panel = read("components/atlas/home/FarmConditionsPanel.tsx");

  assert.match(allApi, /GET as readFarmWeatherRain/);
  assert.match(allApi, /farm-weather-rain/);
  assert.doesNotMatch(allApi, /GET as readFarmConditions/);
  assert.match(legacyRoute, /farm-weather-rain\/route/);
  assert.doesNotMatch(legacyRoute, /lunarGuidance|lunarTaskHint|approximateMoon|tropicalMoonSign/);
  assert.doesNotMatch(panel, /Traditional farm almanac/);
  assert.doesNotMatch(panel, /lunarTaskHints/);
  assert.doesNotMatch(panel, /favoredActions/);
});

test("Legacy almanac code is isolated from canonical task eligibility", () => {
  const legacy = read("lib/atlas/farm-lunar-clock.ts");
  const allApi = read("app/api/atlas/farm-conditions/all/route.ts");
  const skyApi = read("app/api/atlas/sky-state/route.ts");

  assert.match(legacy, /lunarGuidance/);
  assert.match(legacy, /lunarTaskHint/);
  assert.doesNotMatch(allApi, /farm-lunar-clock/);
  assert.doesNotMatch(skyApi, /farm-lunar-clock/);
  assert.doesNotMatch(skyApi, /lunarGuidance|lunarTaskHint|fruitful|barren/);
});

test("Rain-gauge writes cross the reviewed RPC boundary", () => {
  const migration = read("supabase/migrations/20260801041000_atlas_farm_rain_and_lunar_profile_v1.sql");
  const api = read("app/api/atlas/farm-weather-rain/route.ts");

  assert.match(migration, /create table if not exists atlas\.farm_rain_observations/);
  assert.match(migration, /alter table atlas\.farm_rain_observations enable row level security/);
  assert.match(migration, /create or replace function atlas\.record_farm_rain_observation_v1/);
  assert.match(migration, /authenticated_rpc_registry/);
  assert.match(migration, /atlas\.is_farm_member\(p_farm_id\)/);
  assert.match(api, /\.rpc\("record_farm_rain_observation_v1"/);
  assert.doesNotMatch(api, /\.from\("farm_rain_observations"\)\s*\.insert/);
});

test("Home renders conditions inside each actual farm overview card", () => {
  const layout = read("app/layout.tsx");
  const baseCss = read("app/farm-conditions-home.css");
  const mergedCss = read("app/farm-conditions-merged.css");
  const home = read("components/atlas/home/AtlasUniversalHomeV2.tsx");
  const panel = read("components/atlas/home/FarmConditionsPanel.tsx");
  const allApi = read("app/api/atlas/farm-conditions/all/route.ts");

  assert.doesNotMatch(layout, /AtlasFarmConditionsHomePatch/);
  assert.match(layout, /import "\.\/farm-conditions-merged\.css";/);
  assert.match(allApi, /session\.memberships\.map/);
  assert.match(allApi, /GET as readFarmWeatherRain/);
  assert.match(home, /\/api\/atlas\/farm-conditions\/all/);
  assert.match(home, /conditionsByFarmId\[farm\.farmId\]/);
  assert.match(home, /<FarmConditionsPanel conditions=\{conditions\}/);
  assert.match(home, /data-farm-id=\{farm\.farmId\}/);
  assert.match(panel, /atlas-farm-conditions-embedded/);
  assert.doesNotMatch(home + panel, /createPortal|MutationObserver/);
  assert.doesNotMatch(baseCss + mergedCss, /overflow-y:\s*(?:auto|scroll)/);
});

test("Rain gauge age is rendered from the farm-local observed date", () => {
  const panel = read("components/atlas/home/FarmConditionsPanel.tsx");

  assert.match(panel, /daysBetweenIso\(latest\.observationDate, conditions\.observedDate\)/);
  assert.match(panel, /gaugeStatus\(conditions\)/);
  assert.doesNotMatch(panel, /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
});

test("All-farm conditions triangulate weather and rainfall from three configured stations", () => {
  const helper = read("lib/atlas/triangulated-rainfall.ts");
  const allApi = read("app/api/atlas/farm-conditions/all/route.ts");
  const panel = read("components/atlas/home/FarmConditionsPanel.tsx");

  assert.match(helper, /condition_station_points/);
  assert.match(helper, /inverse_distance_weighted_three_point/);
  assert.match(helper, /api\.weather\.gov\/stations/);
  assert.match(helper, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(helper, /readTriangulatedFarmConditions/);
  assert.match(helper, /sourceType:\s*"three_station_triangulation"/);
  assert.match(allApi, /payload\.weather = triangulated\.weather/);
  assert.match(allApi, /payload\.rain\.areaEstimate = triangulated\.rainfall/);
  assert.match(allApi, /payload\.rain\.forecast =/);
  assert.match(panel, /Triangulated rainfall/);
  assert.match(panel, /across three stations/);
});
