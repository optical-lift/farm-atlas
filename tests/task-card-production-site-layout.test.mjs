import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const detail = read("components/atlas/site-layout-task-detail.tsx");

test("only canonical site_layout work enters the production Setup family", () => {
  assert.match(canonical, /function isSiteLayoutTask\(task: AtlasTaskCard\)/);
  assert.match(canonical, /return task\.task_type === "site_layout"/);
  assert.match(canonical, /<SiteLayoutTaskDetail \{\.\.\.props\} initialReadiness=\{initialReadiness\} \/>/);
});

test("Setup is a standalone Task Card Editor family rather than an old generic task wrapper", () => {
  assert.match(detail, /AtlasTaskCardFrame/);
  assert.match(detail, /family="Setup"/);
  assert.match(detail, /data-atlas-site-layout-card="true"/);
  assert.doesNotMatch(detail, /WorkerReadyAssignedTaskExecutionShell/);
  assert.doesNotMatch(detail, /TaskExecutionBrief/);
  assert.doesNotMatch(detail, /atlas-phone-top|atlas-phone-brand|atlas-note-plus/);
});

test("Setup card reads steps, layout dimensions, and materials from live task truth", () => {
  assert.match(detail, /metadata\.execution_how/);
  assert.match(detail, /metadata\.layout_dimensions/);
  assert.match(detail, /dimensions\.bed_width_ft/);
  assert.match(detail, /dimensions\.walkway_width_ft/);
  assert.match(detail, /metadata\.materials_note/);
  assert.match(detail, /task\.resource_requirements/);
  assert.match(detail, />Steps</);
  assert.match(detail, /Bed width/);
  assert.match(detail, /Walkway width/);
  assert.match(detail, /Tools \+ materials/);
});

test("Setup production UI does not copy specimen-only tool values or hardcode live examples", () => {
  assert.doesNotMatch(detail, /Scissors/);
  assert.doesNotMatch(detail, /Measuring tape/);
  assert.doesNotMatch(detail, /Restock/);
  assert.doesNotMatch(detail, /approximately 120/);
  assert.doesNotMatch(detail, /Field Rows · Back Half/);
  assert.doesNotMatch(detail, /U-Pick Beds \+ Walkways/);
});

test("Setup keeps canonical readiness gating and canonical task transitions", () => {
  assert.match(detail, /initialReadiness\.executable === true/);
  assert.match(detail, /initialReadiness\.presentation/);
  assert.match(detail, /postAtlasTaskTransition/);
  assert.match(detail, /transition: outcome/);
  assert.match(detail, /transition\("done"\)/);
  assert.match(detail, /Partly done/);
  assert.match(detail, /Problem found/);
});
