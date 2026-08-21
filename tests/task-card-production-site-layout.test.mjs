import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const detail = read("components/atlas/site-layout-task-detail.tsx");
const shell = read("components/atlas/worker-ready-assigned-task-execution-shell.tsx");
const assignedShell = read("components/atlas/assigned-task-execution-shell.tsx");

test("only canonical site_layout work enters the production Setup family", () => {
  assert.match(canonical, /function isSiteLayoutTask\(task: AtlasTaskCard\)/);
  assert.match(canonical, /return task\.task_type === "site_layout"/);
  assert.match(canonical, /<SiteLayoutTaskDetail \{\.\.\.props\} initialReadiness=\{initialReadiness\} \/>/);
});

test("Setup card reads layout dimensions and materials from live task truth", () => {
  assert.match(detail, /metadata\.layout_dimensions/);
  assert.match(detail, /dimensions\.bed_width_ft/);
  assert.match(detail, /dimensions\.walkway_width_ft/);
  assert.match(detail, /metadata\.materials_note/);
  assert.match(detail, /task\.resource_requirements/);
  assert.match(detail, /Bed width/);
  assert.match(detail, /Walkway width/);
  assert.match(detail, /Tools \+ materials/);
});

test("Setup production UI does not copy specimen-only tool values or fake restock actions", () => {
  assert.doesNotMatch(detail, /Scissors/);
  assert.doesNotMatch(detail, /Measuring tape/);
  assert.doesNotMatch(detail, /Restock/);
  assert.doesNotMatch(detail, /approximately 120/);
  assert.doesNotMatch(detail, /Field Rows · Back Half/);
  assert.doesNotMatch(detail, /U-Pick Beds \+ Walkways/);
});

test("Setup keeps canonical worker readiness and task transition completion", () => {
  assert.match(detail, /WorkerReadyAssignedTaskExecutionShell/);
  assert.match(detail, /initialReadiness=\{initialReadiness\}/);
  assert.match(shell, /initialReadiness\.executable !== true/);
  assert.match(assignedShell, /postAtlasTaskTransition/);
  assert.match(assignedShell, /transition\("done"\)/);
  assert.match(assignedShell, /task\.status === "blocked"/);
});

test("Setup adds information to the real task card instead of a private Atlas header", () => {
  assert.match(detail, /data-atlas-site-layout-setup="true"/);
  assert.match(detail, />Setup<\/span>/);
  assert.doesNotMatch(detail, /atlas-phone-top|atlas-phone-brand|atlas-note-plus/);
});
