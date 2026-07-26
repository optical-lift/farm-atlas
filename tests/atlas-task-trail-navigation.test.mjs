import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the focused task owns one integrated Dominion Trail and condition rail", () => {
  const layout = read("app/layout.tsx");
  const detail = read("components/atlas/dominion-assigned-task-detail.tsx");
  const trail = read("components/atlas/task-dominion-trail.tsx");
  const model = read("lib/atlas/task-condition-rail.ts");
  const styles = read("app/task-condition-rail.css");

  assert.doesNotMatch(layout, /import TaskFocusTendingTrail/);
  assert.doesNotMatch(layout, /^\s*<TaskFocusTendingTrail/m);
  assert.match(layout, /task-dominion-card\.css/);
  assert.match(layout, /task-condition-rail\.css/);
  assert.match(detail, /atlas-dominion-task-card/);
  assert.match(detail, /<TaskDominionTrail task=\{task\} instruction=\{instruction\} \/>/);
  assert.match(detail, /Done/);
  assert.match(detail, /Unfinished/);
  assert.match(detail, /Move or close this card/);
  assert.match(trail, /fetchTendingTaskContext/);
  assert.match(trail, /atlas-task-dominion-track/);
  assert.match(trail, /atlas-task-condition-rail/);
  assert.match(trail, /Now · Target/);
  assert.doesNotMatch(trail, />Why now</);
  assert.doesNotMatch(trail, />This move changes</);
  assert.match(model, /Medium pressure|weed_pressure/);
  assert.match(model, /Even moisture/);
  assert.match(model, /conditionTarget|condition_target/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /atlas-task-result-actions-simple/);
});
