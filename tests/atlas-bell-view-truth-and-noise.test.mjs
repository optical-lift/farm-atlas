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
const followThroughMigration = read("supabase/migrations/20260801004500_atlas_employee_bell_follow_through_v1.sql");

test("Bell list, queue counts, and selected heading share one role-aware contract", () => {
  assert.match(page, /atlasBellItemsForView\(bell\?\.items \?\? \[\], view, bell\?\.effectiveRole\)/);
  assert.match(page, /atlasBellQueueCounts\(bell\?\.items \?\? \[\], bell\?\.effectiveRole\)/);
  assert.match(page, /atlasBellViewSummary\(bell, view, items\)/);
  assert.match(page, /summary\?\.status/);
  assert.match(page, /summary\?\.title/);
  assert.match(page, /summary\?\.emptyMessage/);
});

test("management keeps planning queues while employees receive one follow-through queue", () => {
  assert.match(view, /role === "owner" \|\| role === "manager"/);
  assert.match(view, /atlasBellIsMovementItem\(item\) && item\.requiresAction/);
  assert.match(view, /eyebrow: "Follow through"/);
  assert.match(view, /moved tasks need finishing/);
  assert.match(page, /management \? \(/);
  assert.match(page, />Coming up</);
  assert.match(page, />Older work</);
  assert.match(page, /data-atlas-bell-mode=\{management \? "management" : "follow-through"\}/);
  assert.doesNotMatch(page, />Movement</);
  assert.doesNotMatch(page, />Baseline</);
});

test("Bell cards show action timing, canonical consequence, and destination", () => {
  assert.match(page, /atlasBellActionTiming\(item\)/);
  assert.match(page, /atlasBellActionTitle\(item\)/);
  assert.match(page, /atlasBellConsequence\(item\)/);
  assert.match(page, /consequence\.label/);
  assert.match(page, /consequence\.text/);
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

test("employee movement cards state repeat movement and current consequence", () => {
  assert.match(action, /return movementCount === 1 \? "Moved once" : `Moved \$\{movementCount\} times`/);
  assert.match(action, /Due today/);
  assert.match(action, /days? overdue/);
  assert.match(action, /label: "Unlocks"/);
  assert.match(action, /label: "Result"/);
  assert.match(action, /return "Go to task"/);
  assert.match(styles, /\.atlas-bell-consequence/);
  assert.match(styles, /data-atlas-bell-mode="follow-through"/);
});

test("management Bell titles remain verb-led instructions", () => {
  assert.match(action, /return `Weed \$\{subject\}`/);
  assert.match(action, /return `Mow \$\{location\.join/);
  assert.match(action, /return "Check germination trays"/);
  assert.match(action, /return "Complete Grow Room care"/);
  assert.match(action, /return `Decide: \$\{taskTitle\}`/);
  assert.match(action, /return `Resolve the block on \$\{taskTitle\}`/);
  assert.match(action, /return `Finish \$\{taskTitle\}`/);
  assert.match(action, /return `Start \$\{taskTitle\}`/);
});

test("Bell cover previews management action or employee follow-through", () => {
  assert.match(cover, /href="\/bell"/);
  assert.match(cover, /atlasBellActionTitle\(newest\)/);
  assert.match(cover, /management \? "Do next" : "Follow through"/);
  assert.match(cover, /atlasBellActionTiming\(newest\)/);
  assert.doesNotMatch(cover, /newest\.title/);
  assert.doesNotMatch(cover, /While you were away/);
});

test("routine results stay out of management Bell while employee movement is selected inside Bell history", () => {
  assert.match(migration, /event\.event_kind = 'task_result'/);
  assert.match(migration, /event\.source_event in \('reopened', 'blocked'\)/);
  assert.doesNotMatch(migration, /'task_result', 'maintenance_result'/);
  assert.match(followThroughMigration, /where not v_is_management/);
  assert.match(followThroughMigration, /event\.event_kind = 'task_result'/);
  assert.match(followThroughMigration, /event\.source_event = 'rescheduled'/);
});

test("Bell redesign contains no live farm or member fixtures", () => {
  const build = `${page}\n${view}\n${action}\n${cover}\n${styles}\n${migration}\n${followThroughMigration}`;
  assert.doesNotMatch(build, /6a503d9f|21436a28|23e98e5e|4cd799e2/i);
});
