import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const germination = read("app/task-focus/[taskId]/GerminationFocusPage.tsx");
const germinationRoute = read("app/api/atlas/germination-check/route.ts");
const cropBody = read("components/atlas/crop-cycle-task-card-body.tsx");
const frame = read("components/atlas/task-card-frame.tsx");

test("live Germination uses the production frame and reusable crop-cycle body", () => {
  assert.match(germination, /AtlasTaskCardFrame/);
  assert.match(germination, /CropCycleTaskCardBody/);
  assert.match(frame, /data-atlas-task-card-frame="true"/);
  assert.match(cropBody, /Sown|state\.trail/);
  assert.match(cropBody, /Bed now/);
});

test("Germination logging is completion rather than Done plus a separate log", () => {
  assert.match(germination, /completion=\{completion\}/);
  assert.match(germination, /Strong/);
  assert.match(germination, /Patchy/);
  assert.match(germination, /Failed/);
  assert.match(germination, /Too early to tell/);
  assert.doesNotMatch(germination, /TaskPrimaryResultControls/);
  assert.doesNotMatch(germination, />Done<\/button>/);
  assert.doesNotMatch(germination, />Unfinished<\/button>/);
});

test("live Germination preserves crop-cycle consequences for each observation", () => {
  assert.match(germination, /Strong[\s\S]*germinated[\s\S]*on_target/);
  assert.match(germination, /Patchy[\s\S]*germinated[\s\S]*patch/);
  assert.match(germination, /choice === "Failed"[\s\S]*action: "failed"/);
  assert.match(germination, /Too early to tell[\s\S]*not_yet/);
  assert.match(germination, /choice === "Failed"\) return "Bed open · choose next crop"/);
  assert.match(germination, /harvestRange && choice !== "Failed"/);
  assert.doesNotMatch(germination, /Failed: "Restart"/);
  assert.doesNotMatch(germination, /Failed: "Owner review"/);
});

test("Patchy stays an observation while gap size determines the management consequence", () => {
  assert.match(germination, /small: targetSpacingInches \* 2/);
  assert.match(germination, /large: targetSpacingInches \* 3/);
  assert.match(germination, /observedGapInches >= targetSpacingInches \* 3 \? "Patch gaps" : "Keep growing"/);
  assert.match(germination, /standCondition: selected === "Patchy" \? "patchy" : null/);
  assert.match(germination, /observedGapInches: gapInches/);
  assert.match(germination, /submit\("Patchy", gaps\.small\)/);
  assert.match(germination, /submit\("Patchy", gaps\.large\)/);
  assert.match(germinationRoute, /owner_operator_record_germination_observation_v4/);
  assert.match(germinationRoute, /record_germination_observation_for_member_v4/);
});

test("Germination descriptor resolves the canonical production succession instead of hardcoding a crop-check label", () => {
  assert.match(germination, /familyDetail=\{successionNumber \? `Succession \$\{successionNumber\}` : undefined\}/);
  assert.match(germinationRoute, /from\("production_successions"\)/);
  assert.match(germinationRoute, /select\("sequence_number"\)/);
  assert.doesNotMatch(germination, /crop check/i);
});

test("crop-cycle card uses only dated biological truth it actually has", () => {
  assert.match(germination, /Germination window/);
  assert.match(germination, /Harvest watch/);
  assert.match(germination, /Next move/);
  assert.match(germination, /from result/);
  assert.doesNotMatch(germination, /Water immediately/);
  assert.doesNotMatch(germination, /30 ft|22 ft/);
});
