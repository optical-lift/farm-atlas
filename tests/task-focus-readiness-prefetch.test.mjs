import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const generic = read("components/atlas/worker-ready-assigned-task-execution-shell.tsx");
const readiness = read("lib/atlas/worker-readiness.ts");

test("generic Task Focus resolves Worker readiness during the server render", () => {
  assert.doesNotMatch(canonical, /^"use client"/m);
  assert.match(canonical, /createAtlasServerClient/);
  assert.match(canonical, /worker_task_execution_readiness_api_v1/);
  assert.match(canonical, /normalizeWorkerReadiness/);
  assert.match(canonical, /initialReadiness=\{initialReadiness\}/);
});

test("generic Worker Task Focus has no client readiness fetch or checking interstitial", () => {
  assert.doesNotMatch(generic, /useEffect|useState|fetch\(`\/api\/atlas\/task-execution-readiness/);
  assert.doesNotMatch(generic, /Checking this job|checking readiness/);
  assert.match(generic, /initialReadiness\.executable !== true/);
});

test("readiness presentation stays shared between the API and server render", () => {
  assert.match(readiness, /workerReadinessPresentation/);
  assert.match(readiness, /\["needs_charge", "charging"\]\.includes\(batteryState\)/);
  assert.match(readiness, /This job is waiting on equipment\./);
});
