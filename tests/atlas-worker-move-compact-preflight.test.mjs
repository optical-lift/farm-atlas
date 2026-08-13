import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Farm Hand Task Move is visual-first and keeps explanatory internals out of the default view", () => {
  const spine = read("components/atlas/task-move-spine.tsx");
  const brief = read("components/atlas/task-execution-brief.tsx");

  assert.match(spine, /requirementSection/);
  assert.match(spine, /return requirement\.label\.toLowerCase\(\)\.includes\("tray"\) \? "Trays" : "Container"/);
  assert.match(spine, /requirementStatusLabel/);
  assert.match(spine, /final \? "└──" : "├──"/);
  assert.match(spine, /return unconfirmedCapacity \? "Not yet confirmed" : "Check"/);
  assert.match(spine, /if \(status === "blocked"\) return "Blocked"/);
  assert.match(spine, /4 lit tray spots|lit tray spots/);
  assert.doesNotMatch(spine, />Needs</);
  assert.doesNotMatch(spine, />Do this</);
  assert.doesNotMatch(spine, /step-label">Done/);
  assert.doesNotMatch(spine, /requirement\.note\s*\?/);
  assert.doesNotMatch(spine, /openQuestions/);
  assert.doesNotMatch(spine, /requirementGlyph/);

  assert.match(brief, /function VisibleMethod/);
  assert.match(brief, /className="atlas-worker-method"/);
  assert.match(brief, /const fallbackDetail = !lines\.length/);
  assert.doesNotMatch(brief, /<details className="atlas-worker-instructions">/);
  assert.doesNotMatch(brief, /<summary>Instructions<\/summary>/);
  assert.doesNotMatch(brief, /atlas-human-task-instructions__note/);
});

test("mowing preparation travels with mowing instead of surviving as its own weekly worker task", () => {
  const spine = read("components/atlas/task-move-spine.tsx");
  const dayRoute = read("lib/atlas/day-route.ts");
  const migration = read("supabase/migrations/20260812231600_compact_worker_move_and_mowing_preflight_v1.sql");

  assert.match(spine, />Mowing next</);
  assert.match(spine, /Pick up sticks \+ move hoses first/);
  assert.match(dayRoute, /First: pick up sticks \+ move hoses/);
  assert.match(migration, /yard_stick_pickup_before_wednesday_mowing/);
  assert.match(migration, /update atlas\.work_definitions[\s\S]*active = false/);
  assert.match(migration, /status = case when status = 'open' then 'archived'/);
  assert.match(migration, /state = 'cancelled'/);
  assert.match(migration, /mowing_preflight_embedded/);
});
