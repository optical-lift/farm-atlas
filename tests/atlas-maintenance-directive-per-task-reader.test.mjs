import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/atlas/maintenance-directives/route.ts", import.meta.url), "utf8");

test("maintenance cards load directives by canonical task id", () => {
  assert.match(route, /searchParams\.get\("taskId"\)/);
  assert.match(route, /p_task_id: taskId/);
});
