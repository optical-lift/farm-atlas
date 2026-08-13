import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  assert.doesNotMatch(canonical, /DominionAssignedTaskDetail/);
});

test("the shell owns canonical Task Move blockers and gating while the brief owns compact timing presentation", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const brief = read("components/atlas/task-execution-brief.tsx");
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(shell, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(shell, /assembly\?\.unresolved/);
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} assemblyLoading=\{assemblyLoading\} \/>/);
  assert.match(shell, /const canonicalDoneDisabled =/);
  assert.match(shell, /!assembly \|\|/);
  assert.match(shell, /assembly\.readiness\.status === "blocked"/);
  assert.match(shell, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(shell, /doneDisabled=\{canonicalDoneDisabled\}/);
  assert.match(shell, /This can&apos;t move yet/);

  assert.match(brief, /assemblyControlled = assembly !== undefined/);
  assert.match(brief, /resolvedAssembly\?\.execution\.dueLabel/);
  assert.match(brief, /StableTaskMoveLoading/);
  assert.match(brief, /atlas-worker-fallback__due/);
  assert.match(spine, /assembly\.execution\.dueLabel/);
  assert.match(spine, /data-state=\{requirement.status\}/);
  assert.doesNotMatch(shell, /data-atlas-task-timing="true"|data-atlas-task-readiness="true"/);
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

test("the retired Dominion execution wrapper no longer exists", () => {
  assert.equal(existsSync(join(root, "components/atlas/dominion-assigned-task-detail.tsx")), false);
  assert.equal(existsSync(join(root, "components/atlas/task-dominion-trail.tsx")), false);
  assert.equal(existsSync(join(root, "lib/atlas/task-dominion.ts")), false);
  assert.equal(existsSync(join(root, "lib/atlas/task-condition-rail.ts")), false);
});
