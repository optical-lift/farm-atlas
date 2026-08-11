import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("Pass 4 keeps CURRENT MOVE AFTER semantics while presenting them as a compact human trail", () => {
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(spine, />Right now</);
  assert.match(spine, />Do this</);
  assert.match(spine, /"Target held" : "Finished"/);
  assert.match(spine, /assembly\.spine\.current/);
  assert.match(spine, /assembly\.spine\.move\.action\.label/);
  assert.match(spine, /assembly\.spine\.after/);
  assert.match(spine, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(spine, /data-reachable=\{stopped \? "false" : "true"\}/);
});

test("requirements branch from the work move and are never rendered as ordered execution steps", () => {
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(spine, /aria-label="What this work needs"/);
  assert.match(spine, /assembly\.requirements\.map/);
  assert.match(spine, /atlas-human-task-trail__requirements/);
  assert.match(spine, /atlas-human-task-trail__branch-line/);
  assert.doesNotMatch(spine, /<ol/);
  assert.doesNotMatch(spine, /Step \{?index/);
});

test("Task Move visual states preserve warnings missing requirements blocks and held AFTER targets", () => {
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(spine, /if \(status === "blocked"\) return "Blocked"/);
  assert.match(spine, /if \(status === "missing"\) return "Needed"/);
  assert.match(spine, /if \(status === "warning"\) return "Check"/);
  assert.match(spine, /data-state=\{requirement\.status\}/);
  assert.match(spine, /data-reachable=\{stopped \? "false" : "true"\}/);
  assert.match(spine, /afterFacts\.length \? <FactLines facts=\{afterFacts\}/);
});

test("execution brief resolves the canonical Task Move server-side and preserves compatibility fallback", () => {
  const brief = read("components/atlas/task-execution-brief.tsx");
  const route = read("app/api/atlas/task-move/route.ts");

  assert.match(brief, /TaskMoveSpine/);
  assert.match(brief, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(brief, /taskExecutionModel\(task\)/);
  assert.match(brief, /if \(resolvedAssembly\)/);
  assert.match(brief, /atlas-human-task-fallback/);
  assert.match(route, /resolveTaskMove/);
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /Cache-Control/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
});
