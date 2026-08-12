import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("Pass 4 keeps canonical state/move semantics while presenting an operation-aware trail", () => {
  const spine = read("components/atlas/task-move-spine.tsx");
  const assembly = read("lib/atlas/task-move-assembly.ts");

  assert.match(spine, /assembly\.spine\.current/);
  assert.match(spine, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(spine, /presentation\.actionLabel/);
  assert.match(spine, /presentation\.actionSubject/);
  assert.match(spine, /presentation\.placeRelation/);
  assert.match(spine, /presentation\.methodFacts/);
  assert.match(assembly, /meaningfulResult/);
  assert.match(assembly, /placeRelation/);
  assert.match(spine, /data-reachable=\{stopped \? "false" : "true"\}/);
  assert.doesNotMatch(spine, />Do this</);
  assert.doesNotMatch(spine, />Finished</);
});

test("requirements branch before the operation and are never rendered as ordered execution steps", () => {
  const spine = read("components/atlas/task-move-spine.tsx");
  const currentIndex = spine.indexOf('data-kind="current"');
  const requirementIndex = spine.indexOf('aria-label="What must be true before this move"');
  const actionIndex = spine.indexOf('data-kind="action"');

  assert.ok(currentIndex >= 0);
  assert.ok(requirementIndex > currentIndex);
  assert.ok(actionIndex > requirementIndex);
  assert.match(spine, /aria-label="What this work needs"/);
  assert.match(spine, /groupedRequirements\(assembly\.requirements\)/);
  assert.match(spine, /atlas-human-task-trail__requirements/);
  assert.match(spine, /atlas-human-task-trail__branch-line/);
  assert.doesNotMatch(spine, /<ol/);
  assert.doesNotMatch(spine, /Step \{?index/);
});

test("Task Move visual states preserve warnings, missing requirements, blocks, and held result reachability", () => {
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(spine, /if \(status === "blocked"\) return "Blocked"/);
  assert.match(spine, /if \(status === "missing"\) return "Needed"/);
  assert.match(spine, /status === "warning"/);
  assert.match(spine, /requirement\.capacityStatus !== "confirmed"/);
  assert.match(spine, /return unconfirmedCapacity \? "Not yet confirmed" : "Check"/);
  assert.match(spine, /data-state=\{requirement\.status\}/);
  assert.match(spine, /presentation\.resultText \?/);
  assert.match(spine, /data-reachable=\{stopped \? "false" : "true"\}/);
  assert.match(spine, /stopped \? "Held" : presentation\.resultLabel \|\| "After"/);
});

test("execution brief resolves the canonical Task Move server-side and keeps a fact-only loading fallback", () => {
  const brief = read("components/atlas/task-execution-brief.tsx");
  const route = read("app/api/atlas/task-move/route.ts");

  assert.match(brief, /TaskMoveSpine/);
  assert.match(brief, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(brief, /taskExecutionModel\(task\)/);
  assert.match(brief, /if \(resolvedAssembly\)/);
  assert.match(brief, /atlas-human-task-fallback/);
  assert.match(brief, /Loading structured task details…/);
  assert.doesNotMatch(brief, /requested result is recorded/i);
  assert.match(route, /resolveTaskMove/);
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /workerExecutionTaskMove/);
  assert.match(route, /Cache-Control/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
});
