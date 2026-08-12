import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const spine = read("components/atlas/task-move-spine.tsx");
const brief = read("components/atlas/task-execution-brief.tsx");
const shell = read("components/atlas/assigned-task-execution-shell.tsx");

test("Task Move presents requirements before the physical action and resulting state", () => {
  const requirementIndex = spine.indexOf('aria-label="Needs"');
  const workIndex = spine.indexOf('data-kind="action"');
  const finishIndex = spine.indexOf('data-kind="done"', workIndex);

  assert.ok(requirementIndex >= 0, "worker needs must render");
  assert.ok(workIndex > requirementIndex, "the physical action must follow its needs");
  assert.ok(finishIndex > workIndex, "done state must follow the physical action");
  assert.match(spine, />Needs</);
  assert.match(spine, />Do this</);
  assert.match(spine, />Done</);
});

test("Task Focus reads the canonical Task Move assembly and keeps one worker grammar", () => {
  assert.match(shell, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} \/>/);
  assert.match(brief, /<TaskMoveSpine assembly=\{resolvedAssembly\} \/>/);
  assert.match(brief, /Compatibility rendering/);
});

test("worker requirements retain quantities and state while hiding explanatory internals", () => {
  assert.match(spine, /function compactRequirementLabel\(requirement: TaskMoveRequirement\)/);
  assert.match(spine, /return `\$\{quantity\} × \$\{label\}`/);
  assert.match(spine, /return `\$\{quantity\} \$\{readable\(requirement\.unit\)\}`/);
  assert.match(spine, /data-state=\{requirement.status\}/);
  assert.match(spine, /requirementGlyph/);
  assert.doesNotMatch(spine, /requirement\.note/);
  assert.doesNotMatch(spine, /requirement\.questions/);
  assert.doesNotMatch(spine, /├──|└──/);
});

test("detailed instructions are secondary instead of duplicating the move", () => {
  assert.match(brief, /<details className="atlas-worker-instructions">/);
  assert.match(brief, /<summary>Instructions<\/summary>/);
  assert.match(brief, /fallbackDetail = !lines\.length/);
});
