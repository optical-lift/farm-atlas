import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("worker blocked outcomes use the canonical Owner problem handoff", () => {
  const route = read("app/api/atlas/task-transition/route.ts");

  assert.match(route, /rpcName === "worker_record_task_transition_v1" && input\.transition === "blocked"/);
  assert.match(route, /worker_open_task_problem_handoff_v1/);
  assert.match(route, /p_issue_text: input\.note \|\| input\.reason/);
  assert.match(route, /problemHandoff = !response\.error/);
  assert.match(route, /problemHandoff,/);
});

test("a successful worker problem handoff leaves task focus instead of refreshing stale worker custody", () => {
  const client = read("lib/atlas/task-transition-client.ts");

  assert.match(client, /problemHandoff\?: boolean/);
  assert.match(client, /window\.location\.pathname\.startsWith\("\/task-focus\/"\)/);
  assert.match(client, /input\.transition === "blocked" && data\.problemHandoff === true/);
  assert.match(client, /window\.location\.replace\(destination\)/);
});
