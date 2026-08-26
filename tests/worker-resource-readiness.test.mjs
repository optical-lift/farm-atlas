import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const wrapper = read("components/atlas/worker-ready-assigned-task-execution-shell.tsx");
const execution = read("components/atlas/assigned-task-execution-shell.tsx");
const mowingPage = read("app/task-focus/[taskId]/MowingFocusPage.tsx");
const mowing = read("components/atlas/mowing-focus-card.tsx");
const navigation = read("components/atlas/task-focus-navigation-boundary.tsx");
const mowingViewModel = read("lib/atlas/mowing-card-view-model.ts");
const taskCue = read("app/task-focus/[taskId]/TaskFocusCueDelivery.tsx");
const globalCue = read("app/GlobalDayCueDelivery.tsx");
const readinessRoute = read("app/api/atlas/task-execution-readiness/route.ts");
const readinessContract = read("lib/atlas/worker-readiness.ts");

test("ordinary Worker execution cannot reach result controls until canonical readiness is executable", () => {
  assert.match(canonical, /worker_task_execution_readiness_api_v1/);
  assert.match(canonical, /return <WorkerReadyAssignedTaskExecutionShell/);
  assert.match(wrapper, /if \(!initialReadiness\.ok \|\| typeof initialReadiness\.executable !== "boolean"\)/);
  assert.match(wrapper, /if \(initialReadiness\.executable !== true\)/);
  assert.match(wrapper, /data-atlas-worker-readiness-failure="true"/);
  assert.match(wrapper, /data-atlas-worker-waiting-screen="true"/);
  assert.match(wrapper, /return <AssignedTaskExecutionShell \{\.\.\.props\} \/>/);
  assert.doesNotMatch(wrapper, /fetch\(`\/api\/atlas\/task-execution-readiness/);
  assert.match(execution, /TaskPrimaryResultControls/);
});

test("blocked mowing keeps the truthful card visible but suppresses Done and unfinished controls", () => {
  assert.match(mowingPage, /MowingFocusCard/);
  assert.match(mowing, /const taskReady = readiness\?\.ok === true && readiness\.executable === true/);
  assert.match(mowing, /if \(!taskReady\)/);
  assert.match(mowing, /This job is not ready yet\./);
  assert.match(mowing, /const completion = taskReady \? \(/);
  assert.match(mowing, /data-atlas-task-readiness="blocked"/);
  assert.match(mowing, /<TaskPrimaryResultControls/);
  assert.match(mowing, /<MowingTaskCardBody/);
  assert.match(mowing, /card=\{card\}/);
  assert.match(mowing, /issueDisabled=\{!taskReady \|\| saving\}/);
  assert.match(mowingViewModel, /equipmentGroup/);
  assert.doesNotMatch(mowingViewModel, /Gas|2 batteries/);
});

test("Worker readiness copy stays human while distinguishing battery recovery from management equipment repair", () => {
  assert.match(readinessRoute, /worker_task_execution_readiness_api_v1/);
  assert.doesNotMatch(readinessRoute, /\.rpc\("task_execution_readiness_v1"/);
  assert.match(readinessContract, /\["needs_charge", "charging"\]\.includes\(batteryState\)/);
  assert.match(readinessContract, /The mower batteries need to be charged before this job can start\./);
  assert.match(readinessContract, /Charge them and tap Charged in the reminder\. Then this job will be ready\./);
  assert.match(readinessContract, /This job is waiting on equipment\./);
  assert.match(readinessContract, /Nothing you need to do here right now\./);
  assert.match(readinessContract, /resources: readinessResources\(readiness\)/);
  assert.doesNotMatch(wrapper, /battery_push_mower_battery_set|needs_charge|needs_repair|resourceId|stableKey/);
});

test("full mowing completion pauses navigation for any after-task consequence cue", () => {
  assert.match(mowing, /navigation\.complete\(task\.id\)/);
  assert.match(navigation, /new CustomEvent\("atlas:task-completed"/);
  assert.match(navigation, /if \(window\.dispatchEvent\(event\)\) leaveTaskFocus\(fallbackPath\)/);
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
