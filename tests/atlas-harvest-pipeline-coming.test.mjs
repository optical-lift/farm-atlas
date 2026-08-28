import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("Harvest tab is a task-style crop-to-commerce pipeline, not a separate dashboard", () => {
  const page = read("app/harvest/page.tsx");
  const pipeline = read("app/harvest/HarvestPipelineSection.tsx");

  assert.match(page, /HarvestPipelineSection/);
  assert.match(page, /Crop → customer/);
  assert.match(page, /atlas-harvest-outlook/);
  assert.match(pipeline, /\["COMING", "CUT", "PREP", "READY", "CLAIMED", "OUT"\]/);
  assert.match(pipeline, /\+ Add harvest/);
  assert.doesNotMatch(pipeline, /\+ Add task/i);
  assert.match(pipeline, /Next harvests/);
  assert.match(pipeline, /This is not harvested inventory yet/);
  assert.match(pipeline, /Worker field note/);
  assert.match(pipeline, /Atlas · next cut after harvest/);
});

test("Coming harvests preserve human forecast truth separately from physical harvest", () => {
  const readRoute = read("app/api/atlas/harvest-coming/route.ts");
  const writeRoute = read("app/api/atlas/harvest-expectation/route.ts");

  assert.match(readRoute, /crop_harvest_expectations/);
  assert.match(readRoute, /system_continuation/);
  assert.match(readRoute, /addDays\(cycle\.last_harvest_date, 1\)/);
  assert.match(readRoute, /crop_cycle_yield_forecast/);

  assert.match(writeRoute, /record_crop_harvest_expectation_for_member_v1/);
  assert.match(writeRoute, /owner_operator_record_crop_harvest_expectation_v1/);
  assert.match(writeRoute, /requireAtlasApiAccess/);
  assert.match(writeRoute, /createAtlasServerClient/);
  assert.doesNotMatch(writeRoute, /record_crop_observation_v1|crop_harvest_events|flower_harvest_bucket_observations/);
});

test("Coming composer treats Tomorrow as a first-class harvest date", () => {
  const pipeline = read("app/harvest/HarvestPipelineSection.tsx");

  assert.match(pipeline, />Today<\/button>/);
  assert.match(pipeline, />Tomorrow<\/button>/);
  assert.match(pipeline, /Add to Coming/);
  assert.match(pipeline, /Rough amount/);
  assert.match(pipeline, /Field note/);
});
