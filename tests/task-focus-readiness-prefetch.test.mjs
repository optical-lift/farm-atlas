import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/task-focus/[taskId]/page.tsx");
const generic = read("components/atlas/worker-ready-assigned-task-execution-shell.tsx");
const mowing = read("app/task-focus/[taskId]/MowingFocusPage.tsx");

test("Task Focus resolves Worker readiness during the server render", () => {
  assert.match(page, /worker_task_execution_readiness_api_v1/);
  assert.match(page, /createAtlasServerClient/);
  assert.match(page, /initialReadiness=/);
  assert.match(page, /readiness=/);
});

test("generic Worker Task Focus has no client readiness fetch or checking interstitial", () => {
  assert.doesNotMatch(generic, /useEffect|fetch\(`\/api\/atlas\/task-execution-readiness/);
  assert.doesNotMatch(generic, /Checking this job|checking readiness/);
});

test("mowing Task Focus uses prefetched readiness and has no checking interstitial", () => {
  assert.doesNotMatch(mowing, /useEffect|fetch\(`\/api\/atlas\/task-execution-readiness/);
  assert.doesNotMatch(mowing, /Checking whether this job is ready/);
  assert.match(mowing, /Task readiness could not be loaded/);
});
