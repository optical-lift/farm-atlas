import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const runtime = read("components/atlas/runtime/AtlasRuntimeProvider.tsx");
const reconciliation = read("lib/atlas/runtime-reconciliation.ts");
const bridge = read("lib/atlas/runtime-action-bridge.ts");
const transitionClient = read("lib/atlas/task-transition-client.ts");
const daySurface = read("app/day/DaySurface.tsx");

test("Pass 18 keeps canonical and optimistic Worker Day state separate", () => {
  assert.match(runtime, /canonicalValue: AtlasWorkerDayProjectionRead \| null/);
  assert.match(runtime, /pendingActions: AtlasRuntimePendingAction\[\]/);
  assert.match(runtime, /value: applyAtlasRuntimePendingActions\(input\.canonicalValue, pendingActions\)/);
  assert.match(reconciliation, /canonical revision belongs to the server projection/i);
  assert.match(reconciliation, /never fabricated here/i);
  assert.doesNotMatch(reconciliation, /buildAtlasWorkerDayProjection/);
});

test("Done and Reopen get immediate derived projection overlays without inventing broader status semantics", () => {
  assert.match(reconciliation, /transition === "done"\) return "done"/);
  assert.match(reconciliation, /transition === "reopened"\) return "open"/);
  assert.match(reconciliation, /return null/);
  assert.match(reconciliation, /item\.kind !== "committed_task" && item\.kind !== "potential_task"/);
  assert.match(reconciliation, /statusByTaskId\.get\(item\.taskId\)/);
});

test("shared task transition calls enter AtlasRuntime automatically while it is mounted", () => {
  assert.match(bridge, /registerAtlasRuntimeTaskTransitionHandler/);
  assert.match(bridge, /readAtlasRuntimeTaskTransitionHandler/);
  assert.match(runtime, /registerAtlasRuntimeTaskTransitionHandler\(dispatchTaskTransition\)/);
  assert.match(transitionClient, /const runtimeHandler = readAtlasRuntimeTaskTransitionHandler\(\)/);
  assert.match(transitionClient, /if \(runtimeHandler\) return runtimeHandler\(input\)/);
  assert.match(daySurface, /useAtlasWorkerDayProjection\(dateIso\)/);
});

test("runtime task transitions commit once, rollback overlays on failure, and reconcile only affected loaded days on success", () => {
  assert.match(runtime, /response = await commitAtlasTaskTransition\(request\)/);
  assert.match(runtime, /failed\.pendingActions\.filter\(\(pending\) => pending\.actionId !== actionId\)/);
  assert.match(runtime, /phase: "reconciling" as const/);
  assert.match(runtime, /cachedDatesContainingTasks/);
  assert.match(runtime, /const reconciliationDates = new Set\(serviceDates\)/);
  assert.match(runtime, /Array\.from\(reconciliationDates, \(serviceDate\) => readWorkerDay\(serviceDate, \{ force: true \}\)\)/);
  assert.doesNotMatch(runtime, /Array\.from\(entriesRef\.current\.keys\(\)\)/);
});

test("authoritative reads retire reconciled overlays but preserve concurrently committing actions", () => {
  assert.match(runtime, /filter\(\(action\) => action\.phase !== "reconciling"\)/);
  assert.match(runtime, /current\?\.requestId === requestId/);
  assert.match(runtime, /pendingActions: current\.pendingActions/);
});

test("legacy or non-runtime callers still invalidate only after canonical commit", () => {
  assert.match(transitionClient, /const data = await commitAtlasTaskTransition\(input\);/);
  assert.match(transitionClient, /dispatchAtlasWorkerDayRuntimeInvalidation\(\);/);
  const commit = transitionClient.indexOf("const data = await commitAtlasTaskTransition(input);");
  const invalidation = transitionClient.indexOf("dispatchAtlasWorkerDayRuntimeInvalidation();");
  assert.ok(commit >= 0 && invalidation > commit);
});
