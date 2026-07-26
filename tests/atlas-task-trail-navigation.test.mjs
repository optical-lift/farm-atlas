import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the focused task owns one integrated Dominion Trail", () => {
  const layout = read("app/layout.tsx");
  const detail = read("components/atlas/dominion-assigned-task-detail.tsx");
  const trail = read("components/atlas/task-dominion-trail.tsx");
  const styles = read("app/task-dominion-card.css");

  assert.doesNotMatch(layout, /TaskFocusTendingTrail/);
  assert.match(layout, /task-dominion-card\.css/);
  assert.match(detail, /atlas-dominion-task-card/);
  assert.match(detail, /<TaskDominionTrail task=\{task\} instruction=\{instruction\} \/>/);
  assert.match(detail, /How did this move land\?/);
  assert.match(trail, /fetchTendingTaskContext/);
  assert.match(trail, /atlas-task-dominion-track/);
  assert.match(trail, /Why now/);
  assert.match(trail, /This move changes/);
  assert.match(styles, /\.atlas-task-page-active\.atlas-dominion-task-card/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});
