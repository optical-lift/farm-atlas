import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Living Day renders consequences as timeline states instead of alert cards", () => {
  const patch = read("app/DayConsequenceTimelinePatch.tsx");
  const grammar = read("lib/atlas/day-consequence.ts");
  const css = read("app/day-consequence-timeline.css");
  const layout = read("app/layout.tsx");

  assert.match(layout, /DayConsequenceTimelinePatch/);
  assert.match(layout, /day-consequence-timeline\.css/);
  assert.match(grammar, /Continuing from/);
  assert.match(grammar, /Returned from Owner/);
  assert.match(grammar, /Fallen out of rhythm/);
  assert.match(grammar, /Overdue \$\{overdueDays\}d/);
  assert.match(grammar, /Partly done\$\{partialCount > 1/);
  assert.match(grammar, /last_owner_problem_handoff/);
  assert.match(grammar, /latestOutcome\?\.outcome === "reopened"/);
  assert.match(patch, /Carry forward/);
  assert.match(patch, /morning plan/);
  assert.match(css, /data-atlas-day-consequence="continued"/);
  assert.match(css, /linear-gradient\(90deg/);
  assert.match(css, /Carry-forward is another journal lane/);
  assert.match(css, /background: transparent !important/);
  assert.doesNotMatch(css, /background: var\(--atlas-purple-deep\)/);
});

test("Living Day consequence reader preserves canonical task data", () => {
  const patch = read("app/DayConsequenceTimelinePatch.tsx");
  const route = read("app/api/atlas/living-day-plan/route.ts");
  const migration = read("supabase/migrations/20260730035400_living_day_plan_snapshot_v1.sql");

  assert.match(patch, /fetchAtlasTaskCards/);
  assert.match(patch, /dataset\.atlasDayConsequence/);
  assert.match(route, /prepare_living_day_plan_v1/);
  assert.match(migration, /due_dates_unchanged/);
  assert.match(migration, /withheld_flexible_task_ids/);
  assert.doesNotMatch(patch, /postAtlasTaskTransition/);
  assert.doesNotMatch(patch, /update.*due_date/i);
  assert.doesNotMatch(route, /update.*due_date/i);
  assert.doesNotMatch(patch, /window\.prompt/);
});
