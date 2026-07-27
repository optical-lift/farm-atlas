import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the focused task owns one truthful Dominion Trail and condition rail", () => {
  const layout = read("app/layout.tsx");
  const detail = read("components/atlas/dominion-assigned-task-detail.tsx");
  const trail = read("components/atlas/task-dominion-trail.tsx");
  const renderer = read("components/atlas/trail/AtlasTrail.tsx");
  const model = read("lib/atlas/task-condition-rail.ts");
  const styles = read("app/task-condition-rail.css");

  assert.doesNotMatch(layout, /import TaskFocusTendingTrail/);
  assert.doesNotMatch(layout, /^\s*<TaskFocusTendingTrail/m);
  assert.match(layout, /task-dominion-card\.css/);
  assert.match(layout, /task-condition-rail\.css/);
  assert.match(layout, /atlas-trail\.css/);
  assert.match(detail, /atlas-dominion-task-card/);
  assert.match(detail, /<TaskDominionTrail task=\{task\} instruction=\{instruction\} \/>/);
  assert.match(detail, /const detailHeading = "Steps"/);
  assert.doesNotMatch(detail, /How to play this card/);
  assert.match(detail, /Done/);
  assert.match(detail, /Unfinished/);
  assert.match(detail, /Move or close this card/);
  assert.match(detail, /condition\.meaningful/);
  assert.doesNotMatch(detail, />Result</);
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
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /atlas-task-dominion-no-trail/);
  assert.match(styles, /atlas-task-result-actions-simple/);
});
