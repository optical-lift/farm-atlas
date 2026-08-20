import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const specimens = readFileSync("app/owner/task-card-lab/RemainingDominionCardSpecimens.tsx", "utf8");
const frame = readFileSync("app/owner/task-card-lab/DominionCardFrame.tsx", "utf8");
const editor = readFileSync("app/owner/task-card-lab/page.tsx", "utf8");

test("Task Card Editor renders dedicated Water Care Check and Transplant specimens", () => {
  assert.match(editor, /WaterCareCardSpecimen/);
  assert.match(editor, /CheckCardSpecimen/);
  assert.match(editor, /TransplantCardSpecimen/);
  assert.match(editor, /index === 5[\s\S]*<WaterCareCardSpecimen \/>/);
  assert.match(editor, /index === 6[\s\S]*<CheckCardSpecimen \/>/);
  assert.match(editor, /return <TransplantCardSpecimen \/>/);
});

test("all three new bodies use the same shared top and bottom task chrome", () => {
  assert.match(specimens, /<DominionCardFrame family="Water \/ Care" title="New Zinnia Transplants">/);
  assert.match(specimens, /<DominionCardFrame family="Check" title="Germination Check">/);
  assert.match(specimens, /<DominionCardFrame family="Transplant" title="Move 15 Zinnias">/);
  assert.match(frame, />Done<\/button>/);
  assert.match(frame, />Unfinished<\/button>/);
});

test("Water Care keeps establishment truth compact and issue reporting on resources", () => {
  assert.match(specimens, /Curve Garden/);
  assert.match(specimens, /15 zinnias/);
  assert.match(specimens, /Establishing/);
  assert.match(specimens, /Deep water/);
  assert.match(specimens, /Evenly moist/);
  assert.match(specimens, /No standing runoff/);
  assert.match(specimens, /Condition changed/);
  assert.match(specimens, /Damage \/ loss/);
  assert.match(specimens, /Plant missing/);
  assert.match(specimens, /Water source/);
});

test("Check is an observation to next-move decision surface", () => {
  assert.match(specimens, /Did enough emerge to keep this planting\?/);
  assert.match(specimens, /Strong: "Continue"/);
  assert.match(specimens, /Patchy: "Gap fill"/);
  assert.match(specimens, /Failed: "Restart"/);
  assert.match(specimens, /"Too early to tell": "Wait"/);
  assert.match(specimens, /Next move/);
});

test("Transplant exposes source destination count and aftercare without fake checklist prose", () => {
  assert.match(specimens, /Grow Room/);
  assert.match(specimens, /Zinnia tray · 15 selected/);
  assert.match(specimens, /Curve Garden/);
  assert.match(specimens, /Prepared strip/);
  assert.match(specimens, /Water immediately/);
  assert.doesNotMatch(specimens, /Move the selected zinnias from the source tray/);
  assert.doesNotMatch(specimens, /Finished move should be/);
});

test("new specimens remain fixture-only", () => {
  assert.doesNotMatch(specimens, /fetch\s*\(/);
  assert.doesNotMatch(specimens, /supabase/i);
});
