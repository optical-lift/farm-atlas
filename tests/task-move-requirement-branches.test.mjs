import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const spine = read("components/atlas/task-move-spine.tsx");
const brief = read("components/atlas/task-execution-brief.tsx");
const shell = read("components/atlas/assigned-task-execution-shell.tsx");

test("Task Move keeps requirements as preconditions before the operation", () => {
  const currentIndex = spine.indexOf('<section className="atlas-human-task-trail__step" data-kind="current">');
  const requirementIndex = spine.indexOf('className="atlas-human-task-trail__requirement-cluster"');
  const actionIndex = spine.indexOf('<section className="atlas-human-task-trail__step" data-kind="action">');
  const placeIndex = spine.indexOf('data-kind="place"', actionIndex);

  assert.ok(currentIndex >= 0, "owner-capable current farm-state step must remain available");
  assert.ok(requirementIndex > currentIndex, "requirements must branch before work begins");
  assert.ok(actionIndex > requirementIndex, "the operation must follow its preconditions");
  assert.ok(placeIndex > actionIndex, "structured place must follow the operation identity");
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

test("Task Focus reads the canonical Task Move assembly and never invents a fallback finish story", () => {
  assert.match(shell, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} \/>/);
  assert.match(brief, /<TaskMoveSpine assembly=\{resolvedAssembly\} \/>/);
  assert.match(brief, /Loading structured task details…/);
  assert.doesNotMatch(brief, /<small>Do this<\/small>/);
  assert.doesNotMatch(brief, /<small>Finished<\/small>/);
});

test("operation trail consumes semantic presentation rather than universal Do this / Finished labels", () => {
  assert.match(spine, /presentation\.actionLabel/);
  assert.match(spine, /presentation\.actionSubject/);
  assert.match(spine, /presentation\.placeRelation/);
  assert.match(spine, /presentation\.placeLabel/);
  assert.match(spine, /presentation\.methodFacts\.map/);
  assert.match(spine, /presentation\.resultText \?/);
  assert.doesNotMatch(spine, />Do this</);
  assert.doesNotMatch(spine, />Finished</);
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
