import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const spine = read("components/atlas/task-move-spine.tsx");
const brief = read("components/atlas/task-execution-brief.tsx");
const shell = read("components/atlas/assigned-task-execution-shell.tsx");

test("Task Move presents physical facts and action without manufacturing a redundant finished state", () => {
  assert.match(spine, /function requirementSection\(requirement: TaskMoveRequirement\)/);
  assert.match(spine, /requirementGroups\.map/);
  assert.match(spine, /data-kind="action"/);
  assert.doesNotMatch(spine, /data-kind="done"/);
  assert.doesNotMatch(spine, /step-label">Done/);
  assert.doesNotMatch(spine, />Do this</);
});

test("Task Focus reads the canonical Task Move assembly and keeps one worker grammar", () => {
  assert.match(shell, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} assemblyLoading=\{assemblyLoading\} \/>/);
  assert.match(brief, /<TaskMoveSpine assembly=\{resolvedAssembly\} \/>/);
});

test("worker requirements retain quantities and state in the shared branch grammar while hiding explanatory internals", () => {
  assert.match(spine, /function compactRequirementLabel\(requirement: TaskMoveRequirement\)/);
  assert.match(spine, /return `\$\{quantity\} × \$\{label\}`/);
  assert.match(spine, /return `\$\{quantity\} \$\{readable\(requirement\.unit\)\}`/);
  assert.match(spine, /data-state=\{requirement.status\}/);
  assert.match(spine, /atlas-worker-move__requirements::before/);
  assert.match(spine, /atlas-worker-move__requirement::before/);
  assert.match(spine, /requirementStatusLabel/);
  assert.match(spine, /Not yet confirmed/);
  assert.doesNotMatch(spine, /requirement\.note/);
  assert.doesNotMatch(spine, /requirement\.questions/);
  assert.doesNotMatch(spine, /requirementGlyph/);
});

test("execution instructions are visible compact trail steps instead of a prose drawer", () => {
  assert.match(brief, /function VisibleMethod/);
  assert.match(brief, /className="atlas-worker-method atlas-task-trail-section"/);
  assert.match(brief, /className="atlas-worker-method__list"/);
  assert.match(brief, /atlas-worker-method::before/);
  assert.match(brief, /fallbackDetail = !lines\.length/);
  assert.doesNotMatch(brief, /<details className="atlas-worker-instructions">/);
  assert.doesNotMatch(brief, /<summary>Instructions<\/summary>/);
});
