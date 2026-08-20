import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync("app/api/atlas/task-execution-readiness/route.ts", "utf8");
const shell = fs.readFileSync("components/atlas/worker-ready-assigned-task-execution-shell.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260820193337_worker_task_execution_readiness_api_v1.sql", "utf8");

test("Task Focus reads readiness through the worker-safe RPC", () => {
  assert.match(route, /worker_task_execution_readiness_api_v1/);
  assert.doesNotMatch(route, /\.rpc\("task_execution_readiness_v1"/);
});

test("worker-safe readiness wrapper enforces farm authority before internal readiness", () => {
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /membership\.user_id=auth\.uid\(\)/);
  assert.match(migration, /membership\.role in \('owner','manager'\)/);
  assert.match(migration, /assigned_membership_id is distinct from v_membership\.id/);
  assert.match(migration, /return atlas\.task_execution_readiness_v1\(p_task_id\)/);
  assert.match(migration, /grant execute .* authenticated, service_role/i);
});

test("readiness transport failure never renders as canonical Waiting", () => {
  assert.match(shell, /if \(failed\) return <ReadinessFailureScreen/);
  assert.match(shell, /if \(readiness\?\.executable !== true\) return <WaitingScreen/);
  assert.match(shell, /data-atlas-worker-readiness-failure="true"/);
  assert.match(shell, /This task didn’t load/);
});
