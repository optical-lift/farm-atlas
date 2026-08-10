import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("focused work uses one task execution brief while linked Trails stay optional context", () => {
  const layout = read("app/layout.tsx");
  const detail = read("components/atlas/assigned-task-execution-shell.tsx");
  const dominion = read("components/atlas/dominion-assigned-task-detail.tsx");
  const brief = read("components/atlas/task-execution-brief.tsx");
  const results = read("components/atlas/task-primary-result-controls.tsx");
  const trail = read("components/atlas/task-dominion-trail.tsx");
  const renderer = read("components/atlas/trail/AtlasTrail.tsx");
  const model = read("lib/atlas/task-condition-rail.ts");
  const styles = read("app/task-condition-rail.css");

  assert.doesNotMatch(layout, /import TaskFocusTendingTrail/);
  assert.doesNotMatch(layout, /^\s*<TaskFocusTendingTrail/m);
  assert.match(detail, /atlas-dominion-task-card/);
  assert.match(detail, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} \/>/);
  assert.doesNotMatch(detail, /TaskDominionTrail/);
  for (const label of ["Do", "Place", "How", "Done when"]) assert.ok(brief.includes(label));
  assert.match(detail, /TaskPrimaryResultControls/);
  assert.match(results, /doneLabel = "Done"/);
  assert.match(results, />\s*Unfinished\s*</);
  assert.match(detail, /Partly done/);
  assert.match(detail, /Problem found/);
  assert.match(detail, /Move or close this card/);
  assert.doesNotMatch(detail, />Result</);
  assert.match(dominion, /AssignedTaskExecutionShell/);

  assert.match(trail, /fetchTendingTaskContext/);
  assert.match(trail, /condition\.meaningful/);
  assert.match(trail, /atlasTrailFromTendingTrack/);
  assert.match(trail, /<AtlasTrail context=\{trail\} mode="compact"/);
  assert.match(trail, /atlas-task-dominion-no-trail/);
  assert.match(trail, /aria-label="No linked Trail"/);
  assert.match(trail, /atlas-task-condition-rail/);
  assert.match(trail, /Now · Target/);
  assert.doesNotMatch(trail, /atlas-task-dominion-track/);
  assert.doesNotMatch(trail, />Why now</);
  assert.doesNotMatch(trail, />This move changes</);
  assert.match(renderer, /node\.status === "current" \|\| node\.status === "blocked"/);
  assert.match(model, /taskHasMeaningfulTrail/);
  assert.match(model, /NATURAL_SEQUENCE_ROUTES/);
  assert.match(model, /task_series_key/);
  assert.doesNotMatch(model, /planned_occurrence_id/);
  assert.match(model, /Medium pressure|weed_pressure/);
  assert.match(model, /Even moisture/);
  assert.match(model, /conditionTarget|condition_target/);
  assert.match(model, /route === "general"/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /atlas-task-dominion-no-trail/);
  assert.match(styles, /atlas-task-result-actions-simple/);
});
