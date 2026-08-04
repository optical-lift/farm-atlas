import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Living Day keeps consequence truth while mixing recovery work into accomplish windows", () => {
  const page = read("app/day/page.tsx");
  const patch = read("app/DayConsequenceTimelinePatch.tsx");
  const grammar = read("lib/atlas/day-consequence.ts");
  const consequenceCss = read("app/day-consequence-timeline.css");
  const recoveryCss = read("app/day-overdue-quiet.css");
  const layout = read("app/layout.tsx");

  assert.match(layout, /DayConsequenceTimelinePatch/);
  assert.match(layout, /day-consequence-timeline\.css/);
  assert.match(layout, /day-overdue-quiet\.css/);
  assert.match(grammar, /Continuing from/);
  assert.match(grammar, /Returned from Owner/);
  assert.match(grammar, /Fallen out of rhythm/);
  assert.match(grammar, /Overdue \$\{overdueDays\}d/);
  assert.match(grammar, /Partly done\$\{partialCount > 1/);
  assert.match(grammar, /last_owner_problem_handoff/);
  assert.match(grammar, /latestOutcome\?\.outcome === "reopened"/);

  assert.match(page, /atlas-day-recovery-overview/);
  assert.match(page, /Fallen out of rhythm/);
  assert.match(page, /Morning recovery/);
  assert.match(page, /Afternoon recovery/);
  assert.match(page, /Evening recovery/);
  assert.match(page, /atlas-day-mixed-timeline/);
  assert.match(page, /mixedDaySortValue/);
  assert.match(page, /isOverdueTask\(task, dateIso\)/);
  assert.doesNotMatch(page, /atlas-day-overdue-group/);

  assert.match(patch, /quietInMixedTimeline/);
  assert.match(patch, /removeConsequenceCopy/);
  assert.doesNotMatch(patch, /Added after morning plan/);
  assert.doesNotMatch(patch, /timelineOrder/);
  assert.doesNotMatch(patch, /applyOverdueHeading/);

  assert.match(consequenceCss, /data-atlas-day-consequence="continued"/);
  assert.match(recoveryCss, /atlas-day-command-header-with-recovery/);
  assert.match(recoveryCss, /atlas-day-recovery-count/);
  assert.match(recoveryCss, /atlas-day-window-marker/);
  assert.match(recoveryCss, /atlas-day-overdue-entry/);
  assert.match(recoveryCss, /background: transparent !important/);
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
