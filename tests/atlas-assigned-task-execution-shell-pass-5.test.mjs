import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("Pass 5 gives ordinary assigned tasks one neutral execution shell", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");

  assert.match(shell, /export default function AssignedTaskExecutionShell/);
  assert.match(shell, /TaskExecutionBrief/);
  assert.match(shell, /TaskChildChecklist/);
  assert.match(shell, /TaskPrimaryResultControls/);
  assert.match(shell, /data-atlas-assigned-task-execution-shell="true"/);
  assert.match(canonical, /return <AssignedTaskExecutionShell \{\.\.\.props\} \/>/);
  assert.doesNotMatch(canonical, /return <DominionAssignedTaskDetail \{\.\.\.props\} \/>/);
});

test("the shell owns canonical Task Move resolution, timing, readiness, and blockers", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const brief = read("components/atlas/task-execution-brief.tsx");

  assert.match(shell, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(shell, /assembly\?\.execution\.dueLabel/);
  assert.match(shell, /data-atlas-task-timing="true"/);
  assert.match(shell, /data-atlas-task-readiness="true"/);
  assert.match(shell, /assembly\.readiness\.status/);
  assert.match(shell, /assembly\?\.unresolved/);
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} \/>/);
  assert.match(brief, /assemblyControlled = assembly !== undefined/);
});

test("domain-specific behavior enters through explicit instrument slots without owning the page", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");

  assert.match(shell, /export type AssignedTaskInstrumentContext/);
  assert.match(shell, /export type AssignedTaskMethodInstrument =/);
  assert.match(shell, /methodInstrument\?: AssignedTaskMethodInstrument/);
  assert.match(shell, /methodInstrument \? methodInstrument\(instrumentContext\)/);
  assert.match(shell, /export type AssignedTaskResultInstrumentContext/);
  assert.match(shell, /export type AssignedTaskResultInstrument =/);
  assert.match(shell, /resultInstrument\?: AssignedTaskResultInstrument/);
  assert.match(shell, /resultInstrument \? resultInstrument\(instrumentContext\)/);
  assert.match(shell, /data-atlas-primary-results="true"/);
  assert.match(shell, /DefaultResultInstrument/);
});

test("the universal shell has no task-kind routing or domain-specific execution imports", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");

  assert.doesNotMatch(shell, /task\.task_type\s*===/);
  assert.doesNotMatch(shell, /task\.action_key\s*===/);
  assert.doesNotMatch(shell, /WeedCardTaskLoader|TransplantReadinessTaskDetail|BuyerOutreachTaskDetail|ContractorServiceTaskDetail|ProjectPullTaskDetail|NetworkOutreachTaskDetail|ExecutionChecklistTaskDetail/);
});

test("Dominion is now only a compatibility name over the universal shell", () => {
  const dominion = read("components/atlas/dominion-assigned-task-detail.tsx");

  assert.match(dominion, /AssignedTaskExecutionShell/);
  assert.match(dominion, /return <AssignedTaskExecutionShell \{\.\.\.props\} \/>/);
  assert.doesNotMatch(dominion, /TaskExecutionBrief/);
  assert.doesNotMatch(dominion, /TaskPrimaryResultControls/);
  assert.doesNotMatch(dominion, /postAtlasTaskTransition/);
});
