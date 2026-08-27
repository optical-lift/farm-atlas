import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("Pass 5 gives ordinary assigned tasks one neutral execution shell behind readiness", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const readiness = read("components/atlas/worker-ready-assigned-task-execution-shell.tsx");
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");

  assert.match(shell, /export default function AssignedTaskExecutionShell/);
  assert.match(shell, /TaskExecutionBrief/);
  assert.match(shell, /TaskChildChecklist/);
  assert.match(shell, /TaskPrimaryResultControls/);
  assert.match(shell, /data-atlas-assigned-task-execution-shell="true"/);
  assert.match(canonical, /worker_task_execution_readiness_api_v1/);
  assert.match(canonical, /return <WorkerReadyAssignedTaskExecutionShell \{\.\.\.props\} initialReadiness=\{initialReadiness\} \/>/);
  assert.match(readiness, /initialReadiness\.executable !== true/);
  assert.match(readiness, /return <WaitingScreen/);
  assert.match(readiness, /return <AssignedTaskExecutionShell \{\.\.\.props\} \/>/);
  assert.doesNotMatch(readiness, /fetch\(`\/api\/atlas\/task-execution-readiness/);
  assert.doesNotMatch(canonical, /DominionAssignedTaskDetail/);
});

test("the shell consumes one canonical completion capability instead of reinterpreting readiness", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const capability = read("lib/atlas/task-completion-capability.ts");
  const controls = read("components/atlas/task-primary-result-controls.tsx");
  const brief = read("components/atlas/task-execution-brief.tsx");
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(shell, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(shell, /resolveAtlasTaskCompletionCapability/);
  assert.match(shell, /const completionCapability = resolveAtlasTaskCompletionCapability\(/);
  assert.match(shell, /const canonicalDoneDisabled = !completionCapability\.canComplete/);
  assert.match(shell, /outcome === "done" && !completionCapability\.canComplete/);
  assert.match(shell, /data-atlas-completion-capability=\{completionCapability\.state\}/);
  assert.match(shell, /doneDisabled=\{canonicalDoneDisabled\}/);
  assert.match(shell, /Blocked — resolve this before this task can be completed\./);
  assert.doesNotMatch(shell, /you can still finish this task/);

  assert.match(capability, /export type AtlasTaskCompletionCapabilityState = "available" \| "loading" \| "blocked"/);
  assert.match(capability, /input\.taskStatus === "blocked"/);
  assert.match(capability, /input\.hasOpenStatefulChildren/);
  assert.match(capability, /input\.assembly\.unresolved\.some/);
  assert.match(capability, /input\.assembly\.readiness\.status === "blocked"/);
  assert.match(capability, /input\.assembly\.readiness\.executable !== true/);
  assert.match(capability, /input\.assembly\.spine\.connection === "stops_at_move"/);
  assert.match(capability, /input\.assemblyLoading \? "move_loading" : "move_unavailable"/);
  assert.match(controls, /disabled=\{busy \|\| doneDisabled\}/);
  assert.match(controls, /data-atlas-readiness-guard=\{doneDisabled \? "blocked" : "clear"\}/);

  assert.match(brief, /assemblyControlled = assembly !== undefined/);
  assert.match(brief, /resolvedAssembly\?\.execution\.dueLabel/);
  assert.match(brief, /StableTaskMoveLoading/);
  assert.match(brief, /atlas-worker-fallback__due/);
  assert.match(spine, /assembly\.execution\.dueLabel/);
  assert.match(spine, /data-state=\{requirement.status\}/);
  assert.doesNotMatch(shell, /data-atlas-task-timing="true"|data-atlas-task-readiness="true"/);
});

test("domain-specific behavior enters through explicit instrument slots and receives the same completion capability", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");

  assert.match(shell, /export type AssignedTaskInstrumentContext/);
  assert.match(shell, /export type AssignedTaskMethodInstrument =/);
  assert.match(shell, /methodInstrument\?: AssignedTaskMethodInstrument/);
  assert.match(shell, /methodInstrument \? methodInstrument\(instrumentContext\)/);
  assert.match(shell, /export type AssignedTaskResultInstrumentContext = AssignedTaskInstrumentContext &/);
  assert.match(shell, /completion: AtlasTaskCompletionCapability/);
  assert.match(shell, /export type AssignedTaskResultInstrument =/);
  assert.match(shell, /resultInstrument\?: AssignedTaskResultInstrument/);
  assert.match(shell, /completion: completionCapability/);
  assert.match(shell, /resultInstrument \? resultInstrument\(resultInstrumentContext\)/);
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
