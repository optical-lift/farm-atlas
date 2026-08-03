import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Farm Conditions keeps gauge observations separate from area estimates and forecasts", () => {
  const api = read("app/api/atlas/farm-conditions/route.ts");
  const home = read("app/AtlasFarmConditionsHomePatch.tsx");

  assert.match(api, /farm_rain_observations/);
  assert.match(api, /sourceType:\s*"area_model_estimate"/);
  assert.match(api, /areaEstimate:/);
  assert.match(api, /forecast:/);
  assert.match(home, /Weather and rainfall estimates are separate from the farm gauge/);
  assert.match(home, /Use this farm’s physical gauge/);
});

test("Farm Conditions uses authoritative astronomy with a transparent fallback", () => {
  const api = read("app/api/atlas/farm-conditions/route.ts");
  const lunar = read("lib/atlas/farm-lunar-clock.ts");

  assert.match(api, /https:\/\/aa\.usno\.navy\.mil\/api\/rstt\/oneday/);
  assert.match(api, /U\.S\. Naval Observatory/);
  assert.match(api, /calculated_fallback/);
  assert.match(lunar, /tropical_local_noon/);
  assert.match(lunar, /approximateMoon/);
});

test("Farm almanac guidance is task-aware and never outranks farm viability", () => {
  const api = read("app/api/atlas/farm-conditions/route.ts");
  const lunar = read("lib/atlas/farm-lunar-clock.ts");

  assert.match(lunar, /aboveground_planting/);
  assert.match(lunar, /belowground_planting/);
  assert.match(lunar, /maintenance/);
  assert.match(api, /\["crop window", "field readiness", "weather", "lunar preference"\]/);
});

test("Lunar task classification reads controlled fields instead of task-title prose", () => {
  const lunar = read("lib/atlas/farm-lunar-clock.ts");
  const start = lunar.indexOf("export function classifyLunarTask");
  const end = lunar.indexOf("function displayTitle", start);
  const classifier = lunar.slice(start, end);

  assert.match(classifier, /explicitLunarFamily\(task\)/);
  assert.match(classifier, /ACTION_FAMILIES\[action\]/);
  assert.match(classifier, /TASK_TYPE_FAMILIES\[taskType\]/);
  assert.doesNotMatch(classifier, /task\.title/);
  assert.doesNotMatch(classifier, /display_subject/);
  assert.doesNotMatch(classifier, /crop_family/);
});

test("Lunar task rows show canonical action, subject, family, and location without repeated commentary", () => {
  const lunar = read("lib/atlas/farm-lunar-clock.ts");
  const mergedCss = read("app/farm-conditions-merged.css");

  assert.match(lunar, /metadataString\(task\.metadata, "display_action"\)/);
  assert.match(lunar, /metadataString\(task\.metadata, "display_subject"\)/);
  assert.match(lunar, /metadataString\(task\.metadata, "display_family"\)/);
  assert.match(lunar, /metadataString\(task\.metadata, "display_location"\)/);
  assert.match(lunar, /reason: displayContext\(task, family\)/);
  assert.doesNotMatch(lunar, /align with this traditional work family/);
  assert.match(mergedCss, /atlas-farm-lunar-precedence/);
  assert.match(mergedCss, /atlas-farm-condition-source/);
  assert.match(mergedCss, /display:\s*none/);
});

test("Lunar work ranks farm pressure and unfinished urgency before lunar preference", () => {
  const api = read("app/api/atlas/farm-conditions/route.ts");
  const start = api.indexOf("function compareLunarTaskCandidates");
  const end = api.indexOf("async function readFarmConditions", start);
  const sorter = api.slice(start, end);

  assert.match(api, /priority:\s*string \| null/);
  assert.match(api, /select\("id, title, priority, action_key, task_type, due_date, metadata"\)/);
  assert.match(sorter, /dynamic_priority_score/);
  assert.match(sorter, /taskPriorityRank/);
  assert.match(sorter, /taskConditionRank/);
  assert.match(sorter, /aOverdue/);
  assert.ok(sorter.indexOf("dynamic_priority_score") < sorter.indexOf("lunarFitRank"));
  assert.ok(sorter.indexOf("taskPriorityRank") < sorter.indexOf("lunarFitRank"));
  assert.ok(sorter.indexOf("taskConditionRank") < sorter.indexOf("lunarFitRank"));
  assert.doesNotMatch(api, /\.gte\("due_date", todayIso\)/);
  assert.match(api, /\.limit\(300\)/);
});

test("Rain-gauge writes cross the reviewed RPC boundary", () => {
  const migration = read("supabase/migrations/20260801041000_atlas_farm_rain_and_lunar_profile_v1.sql");
  const api = read("app/api/atlas/farm-conditions/route.ts");

  assert.match(migration, /create table if not exists atlas\.farm_rain_observations/);
  assert.match(migration, /alter table atlas\.farm_rain_observations enable row level security/);
  assert.match(migration, /create or replace function atlas\.record_farm_rain_observation_v1/);
  assert.match(migration, /authenticated_rpc_registry/);
  assert.match(migration, /atlas\.is_farm_member\(p_farm_id\)/);
  assert.match(api, /\.rpc\("record_farm_rain_observation_v1"/);
  assert.doesNotMatch(api, /\.from\("farm_rain_observations"\)\s*\.insert/);
});

test("Home merges conditions into each visible farm overview card", () => {
  const layout = read("app/layout.tsx");
  const baseCss = read("app/farm-conditions-home.css");
  const mergedCss = read("app/farm-conditions-merged.css");
  const home = read("app/AtlasFarmConditionsHomePatch.tsx");
  const allApi = read("app/api/atlas/farm-conditions/all/route.ts");

  assert.match(layout, /AtlasFarmConditionsHomePatch/);
  assert.match(layout, /import "\.\/farm-conditions-merged\.css";/);
  assert.match(allApi, /session\.memberships\.map/);
  assert.match(allApi, /GET as readFarmConditions/);
  assert.match(home, /\/api\/atlas\/farm-conditions\/all/);
  assert.match(home, /section\[aria-label="Farm seasons"\]/);
  assert.match(home, /cardHeader\.after\(node\)/);
  assert.match(home, /atlas-farm-conditions-embedded/);
  assert.doesNotMatch(home, /section\.prepend\(node\)/);
  assert.doesNotMatch(baseCss + mergedCss, /overflow-y:\s*(?:auto|scroll)/);
});

test("Rain gauge age is rendered from the farm-local observed date", () => {
  const home = read("app/AtlasFarmConditionsHomePatch.tsx");

  assert.match(home, /daysBetweenIso\(latest\.observationDate, conditions\.observedDate\)/);
  assert.match(home, /gaugeStatus\(conditions\)/);
  assert.doesNotMatch(home, /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
});

test("All-farm conditions triangulate weather and rainfall from three configured stations", () => {
  const helper = read("lib/atlas/triangulated-rainfall.ts");
  const allApi = read("app/api/atlas/farm-conditions/all/route.ts");
  const home = read("app/AtlasFarmConditionsHomePatch.tsx");

  assert.match(helper, /condition_station_points/);
  assert.match(helper, /inverse_distance_weighted_three_point/);
  assert.match(helper, /api\.weather\.gov\/stations/);
  assert.match(helper, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(helper, /readTriangulatedFarmConditions/);
  assert.match(helper, /sourceType:\s*"three_station_triangulation"/);
  assert.match(allApi, /payload\.weather = triangulated\.weather/);
  assert.match(allApi, /payload\.rain\.areaEstimate = triangulated\.rainfall/);
  assert.match(allApi, /payload\.rain\.forecast =/);
  assert.match(home, /Triangulated rainfall/);
  assert.match(home, /across three stations/);
});
