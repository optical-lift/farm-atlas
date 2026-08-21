import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const germination = read("app/task-focus/[taskId]/GerminationFocusPage.tsx");
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

test("live Germination maps only to existing canonical observation semantics", () => {
  assert.match(germination, /Strong[\s\S]*germinated[\s\S]*on_target/);
  assert.match(germination, /Patchy[\s\S]*germinated[\s\S]*patch/);
  assert.match(germination, /Failed[\s\S]*failed_or_uncertain/);
  assert.match(germination, /Too early to tell[\s\S]*not_yet/);
  assert.match(germination, /Failed: "Owner review"/);
  assert.doesNotMatch(germination, /Failed: "Restart"/);
});

test("crop-cycle card uses only dated biological truth it actually has", () => {
  assert.match(germination, /Germination window/);
  assert.match(germination, /Harvest watch/);
  assert.match(germination, /Next move/);
  assert.match(germination, /from result/);
  assert.doesNotMatch(germination, /Water immediately/);
  assert.doesNotMatch(germination, /30 ft|22 ft/);
});
