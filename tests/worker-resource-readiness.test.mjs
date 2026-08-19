import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const wrapper = read("components/atlas/worker-ready-assigned-task-execution-shell.tsx");
const execution = read("components/atlas/assigned-task-execution-shell.tsx");
const mowing = read("app/task-focus/[taskId]/MowingFocusPage.tsx");
const taskCue = read("app/task-focus/[taskId]/TaskFocusCueDelivery.tsx");
const globalCue = read("app/GlobalDayCueDelivery.tsx");
const readinessRoute = read("app/api/atlas/task-execution-readiness/route.ts");

test("ordinary Worker execution cannot reach result controls until canonical readiness is executable", () => {
  assert.match(canonical, /return <WorkerReadyAssignedTaskExecutionShell/);
  assert.match(wrapper, /fetch\(`\/api\/atlas\/task-execution-readiness\?taskId=/);
  assert.match(wrapper, /if \(failed \|\| readiness\?\.executable !== true\)/);
  assert.match(wrapper, /return <WaitingScreen/);
  assert.match(wrapper, /data-atlas-worker-waiting-screen="true"/);
  assert.match(wrapper, /return <AssignedTaskExecutionShell \{\.\.\.props\} \/>/);
  assert.match(execution, /TaskPrimaryResultControls/);
});

test("blocked mowing suppresses Done and unfinished controls at the task-focus membrane", () => {
  assert.match(mowing, /const taskReady = readiness\?\.executable === true/);
  assert.match(mowing, /if \(!taskReady\)/);
  assert.match(mowing, /This job is not ready yet\./);
  assert.match(mowing, /!taskReady \? \(/);
  assert.match(mowing, /data-atlas-task-readiness="blocked"/);
  assert.match(mowing, /<TaskPrimaryResultControls/);
  assert.match(mowing, /taskReady && task\.equipmentGroup/);
});

test("Worker readiness copy stays human while distinguishing battery recovery from management equipment repair", () => {
  assert.match(readinessRoute, /task_execution_readiness_v1/);
  assert.match(readinessRoute, /\["needs_charge", "charging"\]\.includes\(batteryState\)/);
  assert.match(readinessRoute, /The mower batteries need to be charged before this job can start\./);
  assert.match(readinessRoute, /Charge them and tap Charged in the reminder\. Then this job will be ready\./);
  assert.match(readinessRoute, /This job is waiting on equipment\./);
  assert.match(readinessRoute, /Nothing you need to do here right now\./);
  assert.doesNotMatch(wrapper, /battery_push_mower_battery_set|needs_charge|needs_repair|resourceId|stableKey/);
});

test("full mowing completion pauses navigation for any after-task consequence cue", () => {
  assert.match(mowing, /new CustomEvent\("atlas:task-completed"/);
  assert.match(mowing, /if \(window\.dispatchEvent\(completionEvent\)\) window\.location\.assign\(returnTo\)/);
  assert.match(taskCue, /atlas:task-completed/);
  assert.match(taskCue, /custom\.preventDefault\(\)/);
  assert.match(taskCue, /anchorKind === "after_task"/);
  assert.match(taskCue, /day-cue-response/);
});

test("first-open recovery cues can be made non-dismissible", () => {
  assert.match(globalCue, /currentCue\.payload\.dismissible === false/);
  assert.match(globalCue, /const dismissible = currentCue\.payload\.dismissible !== false/);
  assert.match(globalCue, /\{dismissible \? \(/);
});
