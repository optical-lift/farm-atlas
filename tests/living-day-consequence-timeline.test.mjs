import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Living Day keeps canonical consequence truth while mixing overdue work into accomplish windows", () => {
  const page = read("app/day/page.tsx");
  const grammar = read("lib/atlas/day-consequence.ts");
  const consequenceCss = read("app/day-consequence-timeline.css");
  const overdueCss = read("app/day-overdue-quiet.css");
  const layout = read("app/layout.tsx");

  assert.equal(existsSync(new URL("../app/DayConsequenceTimelinePatch.tsx", import.meta.url)), false);
  assert.doesNotMatch(layout, /DayConsequenceTimelinePatch/);
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
  assert.match(page, /Morning recovery/);
  assert.match(page, /Afternoon recovery/);
  assert.match(page, /Evening recovery/);
  assert.match(page, /atlas-day-mixed-timeline/);
  assert.match(page, /mixedDaySortValue/);
  assert.match(page, /isOverdueTask\(task, dateIso\)/);
  assert.doesNotMatch(page, /atlas-day-overdue-group/);

  assert.match(consequenceCss, /data-atlas-day-consequence="continued"/);
  assert.match(overdueCss, /exact compact Day Route geometry/);
  assert.match(overdueCss, /\.atlas-day-recovery-count/);
  assert.match(overdueCss, /content: "Overdue"/);
  assert.match(overdueCss, /\.atlas-day-window-marker/);
  assert.match(overdueCss, /\.atlas-day-mixed-timeline \.atlas-day-overdue-task-card/);
  assert.doesNotMatch(overdueCss, /\.atlas-day-command-header-with-recovery\s*\{/);
});

test("Living Day consequence rules preserve canonical task data without mutating task dates", () => {
  const grammar = read("lib/atlas/day-consequence.ts");
  const route = read("app/api/atlas/living-day-plan/route.ts");
  const migration = read("supabase/migrations/20260730035400_living_day_plan_snapshot_v1.sql");

  assert.match(grammar, /atlasDayTaskConsequence/);
  assert.match(grammar, /atlasIsCarriedDayTask/);
  assert.match(route, /prepare_living_day_plan_v1/);
  assert.match(migration, /due_dates_unchanged/);
  assert.match(migration, /withheld_flexible_task_ids/);
  assert.doesNotMatch(grammar, /postAtlasTaskTransition|window\.prompt|MutationObserver|document\.querySelector/);
  assert.doesNotMatch(route, /update.*due_date/i);
});
