import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const layout = read("app/layout.tsx");
const daySurface = read("app/day/DaySurface.tsx");
const clock = read("components/atlas/clock/clock-orchestrator.tsx");
const runtime = read("components/atlas/runtime/AtlasRuntimeProvider.tsx");
const runtimeEvents = read("lib/atlas/runtime-events.ts");
const projectionClient = read("lib/atlas/worker-day-projection-client.ts");
const transitionClient = read("lib/atlas/task-transition-client.ts");

test("Pass 17 mounts one persistent AtlasRuntime above Day and Clock", () => {
  assert.match(layout, /AtlasRuntimeProvider/);
  assert.match(layout, /runtimeScopeKey/);
  assert.match(layout, /operatorContext\?\.isOperating \? "operator" : "direct"/);
  assert.match(layout, /operatorContext\.effective\.accountId/);
  assert.match(layout, /<AtlasRuntimeProvider key=\{runtimeScopeKey\} scopeKey=\{runtimeScopeKey\}>/);
  assert.match(layout, /\{children\}[\s\S]*<\/AtlasRuntimeProvider>/);
});

test("runtime cache is partitioned by root viewer scope and keyed by service date inside that scope", () => {
  assert.match(runtime, /new Map<string, WorkerDayRuntimeEntry>/);
  assert.match(runtime, /entriesRef\.current\.get\(dateIso\)/);
  assert.match(runtime, /entriesRef\.current\.set\(dateIso/);
  assert.match(runtime, /version, setVersion/);
  assert.match(runtime, /scopeKey,/);
});

test("runtime coalesces normal reads, permits explicit refresh, and rejects stale request completion", () => {
  assert.match(runtime, /existingRequest/);
  assert.match(runtime, /!options\.force && existingRequest/);
  assert.match(runtime, /requestId = \+\+requestSequenceRef\.current/);
  assert.match(runtime, /current\?\.requestId === requestId/);
  assert.match(runtime, /force: true/);
});

test("Day and Clock acquire the same Worker Day projection through AtlasRuntime", () => {
  assert.match(daySurface, /useAtlasWorkerDayProjection\(dateIso\)/);
  assert.match(daySurface, /data-atlas-worker-day-revision=\{projection\?\.revision\}/);
  assert.match(clock, /useAtlasWorkerDayProjection\(dateIso\)/);
  assert.match(clock, /const sequence=projection\?\.sequence\?\?null/);
  assert.doesNotMatch(clock, /readOwnerClockProjection|readWorkerClockProjection/);
});

test("shared runtime reader preserves Owner-first access and Farm Hand fallback", () => {
  assert.match(projectionClient, /readAtlasWorkerDayProjection/);
  assert.match(projectionClient, /readOwnerWorkerDayProjection\(dateIso\)/);
  assert.match(projectionClient, /canManage: true/);
  assert.match(projectionClient, /readWorkerSelfDayProjection\(dateIso\)/);
  assert.match(projectionClient, /canManage: false/);
});

test("non-runtime task transitions retain commit-then-expire compatibility behavior", () => {
  assert.match(runtimeEvents, /ATLAS_WORKER_DAY_RUNTIME_INVALIDATE_EVENT/);
  assert.match(runtime, /addEventListener\(ATLAS_WORKER_DAY_RUNTIME_INVALIDATE_EVENT/);
  assert.match(transitionClient, /const data = await commitAtlasTaskTransition\(input\);/);
  const commit = transitionClient.indexOf("const data = await commitAtlasTaskTransition(input);");
  const invalidation = transitionClient.indexOf("dispatchAtlasWorkerDayRuntimeInvalidation();");
  assert.ok(commit >= 0 && invalidation > commit);
});
