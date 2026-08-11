import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const spine = read("components/atlas/task-move-spine.tsx");
const brief = read("components/atlas/task-execution-brief.tsx");
const shell = read("components/atlas/assigned-task-execution-shell.tsx");

test("Task Move keeps requirements as branches of the work move, not sequential trail steps", () => {
  const currentIndex = spine.indexOf('<section className="atlas-human-task-trail__step" data-kind="current">');
  const workIndex = spine.indexOf('<section className="atlas-human-task-trail__step" data-kind="work">');
  const requirementIndex = spine.indexOf("assembly.requirements.map", workIndex);
  const finishIndex = spine.indexOf('data-kind="finish"', requirementIndex);

  assert.ok(currentIndex >= 0, "current farm-state step must render");
  assert.ok(workIndex > currentIndex, "work move must follow current state");
  assert.ok(requirementIndex > workIndex, "requirements must render inside the work move");
  assert.ok(finishIndex > requirementIndex, "finished state must follow the move and its requirements");
  assert.match(spine, /atlas-human-task-trail__branch-line/);
  assert.match(spine, />├</);
});

test("Task Focus reads the canonical Task Move assembly and uses one human trail architecture", () => {
  assert.match(shell, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} \/>/);
  assert.match(brief, /<TaskMoveSpine assembly=\{resolvedAssembly\} \/>/);
  assert.match(brief, /Compatibility state while the canonical assembly is loading\/unavailable/);
});

test("requirement branches expose quantity, state, notes, and open questions without becoming instructions", () => {
  assert.match(spine, /quantityLabel\(requirement\)/);
  assert.match(spine, /data-state=\{requirement.status\}/);
  assert.match(spine, /requirement.note/);
  assert.match(spine, /requirement.questions/);
  assert.match(spine, /aria-label="What this work needs"/);
  assert.doesNotMatch(spine, /Instructions/);
});
