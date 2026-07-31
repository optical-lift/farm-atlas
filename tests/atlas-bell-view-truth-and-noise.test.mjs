import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/bell/page.tsx");
const view = read("lib/atlas/bell-view.ts");
const migration = read("supabase/migrations/20260731231500_atlas_quiet_routine_bell_results_v1.sql");

test("Bell list and selected-view heading share one filter contract", () => {
  assert.match(page, /atlasBellItemsForView\(bell\?\.items \?\? \[\], view\)/);
  assert.match(page, /atlasBellViewSummary\(bell, view, items\)/);
  assert.match(page, /summary\?\.status/);
  assert.match(page, /summary\?\.title/);
  assert.match(page, /summary\?\.emptyMessage/);
});

test("Needs you excludes rhythm obligations without claiming their count", () => {
  assert.match(view, /item\.requiresAction && item\.section !== "rhythms"/);
  assert.match(view, /const directNeeds = active/);
  assert.match(view, /const rhythmNeeds = active/);
  assert.match(view, /Direct obligations/);
  assert.match(view, /\$\{directNeeds\} direct/);
  assert.match(view, /\$\{rhythmNeeds\} in Rhythms/);
  assert.match(view, /Due and fallen-out-of-rhythm work stays in Rhythms/);
});

test("Current Bell and the app badge retain the global actionable count", () => {
  assert.match(view, /status: `\$\{bell\.badgeCount\} need you`/);
  assert.match(page, /setAtlasAppBadge\(bell\.badgeCount\)/);
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

test("Bell fix contains no live farm or member fixtures", () => {
  const build = `${page}\n${view}\n${migration}`;
  assert.doesNotMatch(build, /6a503d9f|21436a28|23e98e5e|4cd799e2/i);
});
