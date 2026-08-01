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
  assert.match(home, /Weather and rainfall estimates are separate from the Elm gauge/);
  assert.match(home, /Use the physical Elm gauge here/);
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

test("Elm Almanac guidance is task-aware and never outranks farm viability", () => {
  const api = read("app/api/atlas/farm-conditions/route.ts");
  const lunar = read("lib/atlas/farm-lunar-clock.ts");
  const home = read("app/AtlasFarmConditionsHomePatch.tsx");

  assert.match(lunar, /aboveground_planting/);
  assert.match(lunar, /belowground_planting/);
  assert.match(lunar, /maintenance/);
  assert.match(lunar, /Traditional almanac practice/);
  assert.match(api, /\["crop window", "field readiness", "weather", "lunar preference"\]/);
  assert.match(home, /Lunar timing advises; it does not move a viable crop window on its own/);
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

test("Home mounts a compact Farm Conditions surface without another vertical scroller", () => {
  const layout = read("app/layout.tsx");
  const css = read("app/farm-conditions-home.css");
  const home = read("app/AtlasFarmConditionsHomePatch.tsx");

  assert.match(layout, /AtlasFarmConditionsHomePatch/);
  assert.match(layout, /import "\.\/farm-conditions-home\.css";/);
  assert.match(home, /Weather now/);
  assert.match(home, /Rain at Elm/);
  assert.match(home, /Traditional Elm Almanac/);
  assert.doesNotMatch(css, /overflow-y:\s*(?:auto|scroll)/);
});
