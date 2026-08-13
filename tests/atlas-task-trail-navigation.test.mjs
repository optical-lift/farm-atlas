import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function exists(path) {
  return existsSync(new URL(`../${path}`, import.meta.url));
}

test("focused work uses one compact Task Move execution grammar while linked Trails stay optional context", () => {
  const layout = read("app/layout.tsx");
  const detail = read("components/atlas/assigned-task-execution-shell.tsx");
  const brief = read("components/atlas/task-execution-brief.tsx");
  const move = read("components/atlas/task-move-spine.tsx");
  const results = read("components/atlas/task-primary-result-controls.tsx");
  const renderer = read("components/atlas/trail/AtlasTrail.tsx");

  assert.doesNotMatch(layout, /import TaskFocusTendingTrail/);
  assert.doesNotMatch(layout, /^\s*<TaskFocusTendingTrail/m);
  assert.match(detail, /data-atlas-assigned-task-execution-shell="true"/);
  assert.match(detail, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} \/>/);
  assert.doesNotMatch(detail, /TaskDominionTrail/);
  assert.match(brief, /TaskMoveSpine/);
  assert.match(brief, /function VisibleMethod/);
  assert.match(move, /requirementSection/);
  assert.doesNotMatch(move, />Needs<\/span>/);
  assert.doesNotMatch(move, />Do this<\/span>/);
  assert.doesNotMatch(move, />Done<\/span>/);
  assert.match(move, /data-kind="action"/);
  assert.doesNotMatch(move, /data-kind="done"/);
  assert.doesNotMatch(move, /data-kind="current"/);
  assert.doesNotMatch(move, />Right now<\/span>/);
  assert.match(detail, /TaskPrimaryResultControls/);
  assert.match(results, /doneLabel = "Done"/);
  assert.match(results, />\s*Unfinished\s*</);
  assert.match(detail, /Partly done/);
  assert.match(detail, /Problem found/);
  assert.match(detail, /Move or close this card/);
  assert.doesNotMatch(detail, />Result</);

  assert.equal(exists("components/atlas/dominion-assigned-task-detail.tsx"), false);
  assert.equal(exists("components/atlas/task-dominion-trail.tsx"), false);
  assert.equal(exists("lib/atlas/task-condition-rail.ts"), false);
  assert.equal(exists("lib/atlas/task-dominion.ts"), false);

  assert.match(renderer, /node\.status === "current" \|\| node\.status === "blocked"/);
});
