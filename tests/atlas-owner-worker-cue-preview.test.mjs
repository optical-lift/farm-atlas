import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const dayCue = read("app/day/DayCueDelivery.tsx");
const taskCue = read("app/task-focus/[taskId]/TaskFocusCueDelivery.tsx");
const taskCueRoute = read("app/api/atlas/task-day-cues/route.ts");
const switcher = read("app/OwnerOperatorMode.tsx");

test("an actionable Day cue opens its canonical task instead of merely recording opened", () => {
  assert.match(dayCue, /cue\.payload\.taskId/);
  assert.match(dayCue, /cue\.anchorTaskId/);
  assert.match(dayCue, /router\.push\(`\/task-focus\/\$\{taskId\}\?returnTo=/);
  assert.match(dayCue, /if \(!isOperatorPreview\) await resolveCue\(\{ opened: "true" \}\)/);
  assert.match(dayCue, /targetTaskId \? openCueTask\(\) : resolveCue\(\)/);
});

test("the Owner operator lens receives the exact worker Day cue as a non-mutating preview", () => {
  assert.match(dayCue, /targetSource !== "worker_self" && targetSource !== "operator_lens"/);
  assert.match(dayCue, /data-atlas-cue-preview=\{isOperatorPreview \? "owner" : "worker"\}/);
  assert.match(dayCue, /Owner cue preview · testing will not clear this for the worker/);

  const previewBranch = dayCue.indexOf("if (isOperatorPreview) {");
  const responseWrite = dayCue.indexOf('fetch("/api/atlas/day-cue-response"');
  assert.ok(previewBranch >= 0 && responseWrite > previewBranch, "preview exits before the worker cue-response write");
});

test("Task Focus cues preserve the same worker cue preview after the Owner taps through", () => {
  assert.match(taskCueRoute, /readAtlasOwnerOperatorContext/);
  assert.match(taskCueRoute, /task\?\.assigned_membership_id === operatorContext\.effective\.farmMembershipId/);
  assert.match(taskCueRoute, /targetSource = "operator_lens"/);
  assert.match(taskCue, /response\?\.targetSource === "worker_self" \|\| isOperatorPreview/);
  assert.match(taskCue, /setDismissedForSession/);
  assert.match(taskCue, /Owner cue preview · testing will not clear this for the worker/);

  const previewBranch = taskCue.indexOf("if (isOperatorPreview) {");
  const responseWrite = taskCue.indexOf('fetch("/api/atlas/day-cue-response"');
  assert.ok(previewBranch >= 0 && responseWrite > previewBranch, "Task Focus preview exits before the worker cue-response write");
});

test("worker cues have a non-mutating escape instead of trapping the app", () => {
  assert.match(dayCue, /function closeCueForNow\(\)/);
  assert.match(dayCue, /Close for now/);
  assert.match(dayCue, /onClick=\{closeCueForNow\}/);
  assert.match(taskCue, /function closeCueForNow\(\)/);
  assert.match(taskCue, /Close for now/);
  assert.match(taskCue, /onClick=\{closeCueForNow\}/);

  const dayClose = dayCue.slice(dayCue.indexOf("function closeCueForNow()"), dayCue.indexOf("async function resolveCue"));
  const taskClose = taskCue.slice(taskCue.indexOf("function closeCueForNow()"), taskCue.indexOf("async function resolve"));
  assert.doesNotMatch(dayClose, /day-cue-response/);
  assert.doesNotMatch(taskClose, /day-cue-response/);
});

test("closing an after-task cue releases the completed task instead of trapping Task Focus", () => {
  assert.match(taskCue, /activeCue\.anchorKind === "after_task"/);
  assert.match(taskCue, /window\.location\.assign\(completionReturn\(completion, "\/day"\)\)/);
});

test("the account switcher tells the Owner which interactions are safe previews", () => {
  assert.match(switcher, /Worker cues are safe previews/);
  assert.match(switcher, /does not clear or answer it/);
  assert.match(switcher, /Other task actions still change live Atlas data/);
});
