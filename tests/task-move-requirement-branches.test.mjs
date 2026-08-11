import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const spine = read("components/atlas/task-move-spine.tsx");
const brief = read("components/atlas/task-execution-brief.tsx");
const shell = read("components/atlas/assigned-task-execution-shell.tsx");

test("Task Move keeps requirements as precondition branches between current state and the work move", () => {
  const currentIndex = spine.indexOf('<section className="atlas-human-task-trail__step" data-kind="current">');
  const requirementIndex = spine.indexOf('className="atlas-human-task-trail__requirement-cluster"');
  const workIndex = spine.indexOf('<section className="atlas-human-task-trail__step" data-kind="work">');
  const finishIndex = spine.indexOf('data-kind="finish"', workIndex);

  assert.ok(currentIndex >= 0, "current farm-state step must render");
  assert.ok(requirementIndex > currentIndex, "requirements must branch from the current state before work begins");
  assert.ok(workIndex > requirementIndex, "the work move must follow its preconditions");
  assert.ok(finishIndex > workIndex, "finished state must follow the work move");
  assert.match(spine, /aria-label="What must be true before this move"/);
  assert.match(spine, /atlas-human-task-trail__branch-line/);
  assert.match(spine, /"├──"/);
  assert.match(spine, /"└──"/);
});

test("same-kind Task Move requirements group into one semantic branch", () => {
  assert.match(spine, /function groupedRequirements\(requirements: TaskMoveRequirement\[\]\)/);
  assert.match(spine, /const groups = new Map<string, RequirementGroup>\(\)/);
  assert.match(spine, /if \(existing\) existing\.requirements\.push\(requirement\)/);
  assert.match(spine, /requirement\.kind === "container"\) return "Container"/);
  assert.match(spine, /requirement\.kind === "medium"\) return "Medium"/);
  assert.match(spine, /requirement\.kind === "capacity" && requirement\.capacityRole === "destination"\) return "Destination capacity"/);
});

test("Task Focus reads the canonical Task Move assembly and uses one human trail architecture", () => {
  assert.match(shell, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} \/>/);
  assert.match(brief, /<TaskMoveSpine assembly=\{resolvedAssembly\} \/>/);
  assert.match(brief, /Compatibility state while the canonical assembly is loading\/unavailable/);
});

test("requirement branches use human quantities and preserve state, notes, and open questions", () => {
  assert.match(spine, /function requirementLine\(requirement: TaskMoveRequirement\)/);
  assert.match(spine, /return `\$\{requirement\.quantity\} × \$\{requirement\.label\}`/);
  assert.match(spine, /return `\$\{requirement\.quantity\} \$\{readable\(requirement\.unit\)\}`/);
  assert.match(spine, /<strong>\{requirementLine\(requirement\)\}<\/strong>/);
  assert.match(spine, /data-state=\{requirement.status\}/);
  assert.match(spine, /requirement.note/);
  assert.match(spine, /requirement.questions/);
  assert.match(spine, /aria-label="What this work needs"/);
  assert.doesNotMatch(spine, /Instructions/);
});
