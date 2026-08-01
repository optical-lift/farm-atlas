import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/bell/page.tsx");
const view = read("lib/atlas/bell-view.ts");
const action = read("lib/atlas/bell-action.ts");
const cover = read("components/atlas/home/AtlasBellCover.tsx");
const styles = read("app/bell.css");
const migration = read("supabase/migrations/20260731231500_atlas_quiet_routine_bell_results_v1.sql");

test("Bell list, queue counts, and selected heading share one action contract", () => {
  assert.match(page, /atlasBellItemsForView\(bell\?\.items \?\? \[\], view\)/);
  assert.match(page, /atlasBellQueueCounts\(bell\?\.items \?\? \[\]\)/);
  assert.match(page, /atlasBellViewSummary\(bell, view, items\)/);
  assert.match(page, /summary\?\.status/);
  assert.match(page, /summary\?\.title/);
  assert.match(page, /summary\?\.emptyMessage/);
});

test("Bell navigation is organized by what the member should do", () => {
  assert.match(view, /"now" \| "next" \| "older"/);
  assert.match(view, /!item\.baseline && item\.requiresAction/);
  assert.match(view, /item\.eventKind === "rhythm_warning"/);
  assert.match(view, /item\.baseline && item\.requiresAction/);
  assert.match(view, /eyebrow: "Do now"/);
  assert.match(view, /eyebrow: "Plan ahead"/);
  assert.match(view, /eyebrow: "Older work"/);
  assert.match(page, />Do now</);
  assert.match(page, />Coming up</);
  assert.match(page, />Older work</);
  assert.doesNotMatch(page, />Movement</);
  assert.doesNotMatch(page, />Baseline</);
});

test("Bell cards show only the action, timing, and destination", () => {
  assert.match(page, /atlasBellActionTiming\(item\)/);
  assert.match(page, /atlasBellActionTitle\(item\)/);
  assert.match(page, /atlasBellOpenLabel\(item\)/);
  assert.doesNotMatch(page, /item\.detail/);
  assert.doesNotMatch(page, /item\.why/);
  assert.doesNotMatch(page, /Why you’re seeing this/);
  assert.doesNotMatch(page, /Acknowledge/);
  assert.doesNotMatch(page, /Mark reviewed/);
  assert.doesNotMatch(page, /Bell points into the work/);
  assert.doesNotMatch(page, /atlas-bell-baseline-card/);
  assert.doesNotMatch(styles, /atlas-bell-summary p/);
});

test("Bell titles are verb-led instructions instead of event-history statements", () => {
  assert.match(action, /return `Weed \$\{subject\}`/);
  assert.match(action, /return `Mow \$\{location\.join/);
  assert.match(action, /return "Check germination trays"/);
  assert.match(action, /return "Complete Grow Room care"/);
  assert.match(action, /return `Decide: \$\{taskTitle\}`/);
  assert.match(action, /return `Resolve the block on \$\{taskTitle\}`/);
  assert.match(action, /return `Finish \$\{taskTitle\}`/);
  assert.match(action, /return `Start \$\{taskTitle\}`/);
  assert.match(action, /return "Overdue"/);
  assert.match(action, /return "Due now"/);
});

test("Bell cover opens the action queue and previews the next action", () => {
  assert.match(cover, /href="\/bell"/);
  assert.match(cover, /atlasBellActionTitle\(newest\)/);
  assert.match(cover, />Do next</);
  assert.doesNotMatch(cover, /newest\.title/);
  assert.doesNotMatch(cover, /While you were away/);
});

test("routine task and maintenance results remain history instead of Bell notifications", () => {
  assert.match(migration, /event\.event_kind = 'task_result'/);
  assert.match(migration, /event\.source_event in \('reopened', 'blocked'\)/);
  assert.doesNotMatch(migration, /'task_result', 'maintenance_result'/);
  assert.doesNotMatch(migration, /or event\.event_kind = 'maintenance_result'/);
  assert.match(migration, /Routine done, partial, rescheduled, changed-plan, and maintenance result records remain in the Journal and Trail/);
});

test("exceptional Bell signals remain worthy", () => {
  assert.match(migration, /event\.importance in \('attention', 'critical'\)/);
  assert.match(migration, /'rhythm_warning', 'rhythm_due', 'rhythm_failure'/);
  assert.match(migration, /'unlock', 'production_change', 'owner_decision'/);
  assert.match(migration, /'reopened', 'blocked'/);
});

test("Bell redesign contains no live farm or member fixtures", () => {
  const build = `${page}\n${view}\n${action}\n${cover}\n${styles}\n${migration}`;
  assert.doesNotMatch(build, /6a503d9f|21436a28|23e98e5e|4cd799e2/i);
});
