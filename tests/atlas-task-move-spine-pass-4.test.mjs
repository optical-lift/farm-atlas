import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("Pass 4 renders CURRENT MOVE AFTER as the one semantic spine", () => {
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(spine, />Current</);
  assert.match(spine, />Move</);
  assert.match(spine, />After</);
  assert.match(spine, /assembly\.spine\.current/);
  assert.match(spine, /assembly\.spine\.move\.action\.label/);
  assert.match(spine, /assembly\.spine\.after/);
  assert.match(spine, /spine\.connection === "stops_at_move"/);
  assert.match(spine, /data-reachable=\{stopped \? "false" : "true"\}/);
});

test("requirements branch from MOVE and are never rendered as ordered execution steps", () => {
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(spine, /Needed for this move/);
  assert.match(spine, /assembly\.requirements\.map/);
  assert.match(spine, /atlas-task-move-spine__branch-grid/);
  assert.doesNotMatch(spine, /<ol/);
  assert.doesNotMatch(spine, /Step \{?index/);
});

test("Task Move visual states distinguish resolved warning missing and blocked without erasing AFTER", () => {
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(spine, /resolved: "Ready"/);
  assert.match(spine, /warning: "Check"/);
  assert.match(spine, /missing: "Missing"/);
  assert.match(spine, /blocked: "Blocked"/);
  assert.match(spine, /data-state=\{requirement\.status\}/);
  assert.match(spine, /stopped \? "Target held"/);
  assert.match(spine, /<FactList facts=\{assembly\.spine\.after\} \/>/);
});

test("execution brief resolves the canonical Task Move server-side and preserves compatibility fallback", () => {
  const brief = read("components/atlas/task-execution-brief.tsx");
  const route = read("app/api/atlas/task-move/route.ts");

  assert.match(brief, /TaskMoveSpine/);
  assert.match(brief, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(brief, /taskExecutionModel\(task\)/);
  assert.match(brief, /if \(resolvedAssembly\)/);
  assert.match(route, /resolveTaskMove/);
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /Cache-Control/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
});
