import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const weed = readFileSync("app/owner/task-card-lab/WeedCardSpecimen.tsx", "utf8");
const remaining = readFileSync("app/owner/task-card-lab/RemainingDominionCardSpecimens.tsx", "utf8");
const frame = readFileSync("app/owner/task-card-lab/DominionCardFrame.tsx", "utf8");
const editor = readFileSync("app/owner/task-card-lab/page.tsx", "utf8");

test("Irrigation and Germination are crop-cycle variants rather than standalone gallery families", () => {
  assert.match(weed, /function CropCycleBedCard/);
  assert.match(weed, /function IrrigationCard/);
  assert.match(weed, /function GerminationCard/);
  assert.match(weed, /Same crop-cycle bed shell · irrigation care pulse/);
  assert.match(weed, /Same crop-cycle bed shell · germination observation/);
  assert.doesNotMatch(editor, /Water \/ Care/);
  assert.doesNotMatch(editor, /"Check"/);
  assert.doesNotMatch(editor, /WaterCareCardSpecimen|CheckCardSpecimen/);
});

test("shared card shell restores a place or zone subtitle without changing universal completion controls", () => {
  assert.match(frame, /subtitle\?: string/);
  assert.match(frame, /className=\{styles\.subtitle\}/);
  assert.match(frame, />Done<\/button>/);
  assert.match(frame, />Unfinished<\/button>/);
});

test("Irrigation is named Irrigation and remains attached to the same bed crop and Trail", () => {
  assert.match(weed, /family="Irrigation"/);
  assert.match(weed, /title="Field Row 13"/);
  assert.match(weed, /subtitle="Field Rows"/);
  assert.match(weed, /ProCut Orange sunflower/);
  assert.match(weed, /Irrigate/);
  assert.match(weed, /care pulse/);
  assert.match(weed, /Hose line/);
  assert.match(weed, /Field Rows hose line/);
  assert.match(weed, /Evenly moist/);
  assert.doesNotMatch(weed, /Water \/ Care/);
});

test("Germination uses the same bed shell and branches the crop cycle from observation", () => {
  assert.match(weed, /family="Check"/);
  assert.match(weed, /Germination/);
  assert.match(weed, /Did enough emerge to keep this planting\?/);
  assert.match(weed, /Strong: "Continue"/);
  assert.match(weed, /Patchy: "Gap fill"/);
  assert.match(weed, /Failed: "Restart"/);
  assert.match(weed, /"Too early to tell": "Wait"/);
  assert.match(weed, /BedMap cropLabel="ProCut Orange sunflower"/);
});

test("Transplant remains a distinct move but uses the universal zone subtitle", () => {
  assert.match(editor, /TransplantCardSpecimen/);
  assert.match(remaining, /<DominionCardFrame family="Transplant" title="Move 15 Zinnias" subtitle="Curve Garden">/);
  assert.match(remaining, /Grow Room/);
  assert.match(remaining, /Water immediately/);
});

test("crop-cycle specimens remain fixture-only", () => {
  assert.doesNotMatch(weed, /fetch\s*\(/);
  assert.doesNotMatch(weed, /supabase/i);
  assert.doesNotMatch(remaining, /fetch\s*\(/);
  assert.doesNotMatch(remaining, /supabase/i);
});
