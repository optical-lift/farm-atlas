import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("Pass 4 keeps canonical Move semantics while presenting only worker-useful cues", () => {
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(spine, /requirementSection/);
  assert.match(spine, /operationLabel/);
  assert.match(spine, /assembly\.spine\.move\.action\.label/);
  assert.match(spine, /assembly\.execution\.what/);
  assert.doesNotMatch(spine, /assembly\.execution\.doneWhen/);
  assert.doesNotMatch(spine, />Needs</);
  assert.doesNotMatch(spine, />Do this</);
  assert.doesNotMatch(spine, />Done</);
  assert.doesNotMatch(spine, />Right now</);
  assert.doesNotMatch(spine, /Target held/);
});

test("requirements remain preconditions and are never rendered as ordered execution prose", () => {
  const spine = read("components/atlas/task-move-spine.tsx");
  const requirementIndex = spine.indexOf("{requirementGroups.map(([label, requirements]) => (");
  const workIndex = spine.indexOf('<section className="atlas-worker-move__step" data-kind="action">');

  assert.ok(requirementIndex >= 0);
  assert.ok(workIndex > requirementIndex);
  assert.match(spine, /assembly\.requirements/);
  assert.match(spine, /data-state=\{requirement.status\}/);
  assert.doesNotMatch(spine, /<ol/);
  assert.doesNotMatch(spine, /Step \{?index/);
  assert.doesNotMatch(spine, /requirement\.note/);
  assert.doesNotMatch(spine, /requirement\.questions/);
});

test("Task Move visual states retain resolved warning and blocked meaning without explanatory labels", () => {
  const spine = read("components/atlas/task-move-spine.tsx");

  assert.match(spine, /if \(status === "resolved"\) return "✓"/);
  assert.match(spine, /if \(status === "warning"\) return "○"/);
  assert.match(spine, /return "!"/);
  assert.match(spine, /data-state=\{requirement.status\}/);
  assert.doesNotMatch(spine, /Not yet confirmed/);
  assert.doesNotMatch(spine, /return "Blocked"/);
});

test("execution brief resolves canonical Task Move and keeps a compact compatibility fallback", () => {
  const brief = read("components/atlas/task-execution-brief.tsx");
  const route = read("app/api/atlas/task-move/route.ts");

  assert.match(brief, /TaskMoveSpine/);
  assert.match(brief, /\/api\/atlas\/task-move\?taskId=/);
  assert.match(brief, /taskExecutionModel\(task\)/);
  assert.match(brief, /if \(resolvedAssembly\)/);
  assert.match(brief, /atlas-worker-fallback/);
  assert.match(route, /resolveTaskMove/);
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /Cache-Control/);
});
