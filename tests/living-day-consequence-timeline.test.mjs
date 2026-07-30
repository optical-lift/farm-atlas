import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Living Day renders consequences as timeline states instead of alert cards", () => {
  const patch = read("app/DayConsequenceTimelinePatch.tsx");
  const css = read("app/day-consequence-timeline.css");
  const layout = read("app/layout.tsx");

  assert.match(layout, /DayConsequenceTimelinePatch/);
  assert.match(layout, /day-consequence-timeline\.css/);
  assert.match(patch, /Continuing from/);
  assert.match(patch, /Returned from Owner/);
  assert.match(patch, /Carry forward/);
  assert.match(patch, /Overdue \$\{overdueDays\}d/);
  assert.match(patch, /Partly done\$\{partialCount > 1/);
  assert.match(patch, /last_owner_problem_handoff/);
  assert.match(patch, /latestOutcome\?\.outcome === "reopened"/);
  assert.match(css, /data-atlas-day-consequence="continued"/);
  assert.match(css, /linear-gradient\(90deg/);
  assert.match(css, /Carry-forward is another journal lane/);
  assert.match(css, /background: transparent !important/);
  assert.doesNotMatch(css, /background: var\(--atlas-purple-deep\)/);
});

test("Living Day consequence reader preserves canonical task data", () => {
  const patch = read("app/DayConsequenceTimelinePatch.tsx");

  assert.match(patch, /fetchAtlasTaskCards/);
  assert.match(patch, /dataset\.atlasDayConsequence/);
  assert.doesNotMatch(patch, /postAtlasTaskTransition/);
  assert.doesNotMatch(patch, /update.*due_date/i);
  assert.doesNotMatch(patch, /window\.prompt/);
});
