import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const carryForward = read("lib/atlas/home-carry-forward.ts");
const page = read("app/page.tsx");
const home = read("components/atlas/home/AtlasUniversalHomeV2.tsx");

test("the purple Home cover prepends unresolved work from earlier days", () => {
  assert.match(carryForward, /item\.date < today/);
  assert.match(carryForward, /card\.due_date >= today/);
  assert.match(carryForward, /category: `Overdue · \$\{atlasDayTaskFamily\(card\)\}`/);
  assert.match(carryForward, /moves: \[\.\.\.overdueMoves, \.\.\.remainingMoves\]\.slice\(0, 4\)/);
  assert.match(carryForward, /atlasWorkOrderSortValue\(left\.card\)/);
});

test("Home carry-forward respects the same parent and quiet-task filters as the hero", () => {
  assert.match(carryForward, /Boolean\(card\.parent_task_id\)/);
  assert.match(carryForward, /hide_from_home_hero/);
  assert.match(carryForward, /quiet_task/);
  assert.match(carryForward, /checklist_status/);
  assert.match(carryForward, /isOpenDisplayTask\(card\)/);
});

test("carry-forward display does not corrupt today's completion denominator", () => {
  const summaryBlock = carryForward.match(/summary: \{[\s\S]*?\n    \},\n  \};\n\}/)?.[0] ?? "";
  assert.match(summaryBlock, /\.\.\.overview\.summary/);
  assert.match(summaryBlock, /carryForwardCount: Math\.max/);
  assert.doesNotMatch(summaryBlock, /plannedTotal:/);
  assert.doesNotMatch(summaryBlock, /dealtCount:/);
  assert.doesNotMatch(summaryBlock, /openCount:/);
});

test("both ordinary and Owner-switched Home pass through one carry-forward queue", () => {
  assert.match(page, /const \[baseTaskOverview, farmSeasons, personalDayProgress\]/);
  assert.match(page, /readAtlasSwitchedFarmHandHomeOverview/);
  assert.match(page, /readAtlasOperatorHomeTaskOverview/);
  assert.match(page, /withAtlasHomeCarryForward\(visibleHome, reconciledTaskOverview\)/);
  assert.match(page, /\.\.\.taskOverview/);
  assert.match(page, /moves: taskOverview\.moves\.filter/);
  assert.match(page, /dayOverview=\{visibleTaskOverview\.summary\}/);
});

test("Home never describes a carry-forward day as clear", () => {
  assert.match(home, /const hasCarryForward = dayOverview\.carryForwardCount > 0/);
  assert.match(home, /const overdueLabel =/);
  assert.match(home, /: hasCarryForward\s*\? overdueLabel\s*: dayOverview\.personalScope/);
  assert.match(home, /hasCarryForward \? overdueLabel : dayOverview\.personalScope/);
  assert.match(home, /dayOverview\.plannedTotal > 0 && hasCarryForward/);
});

test("the carry-forward adapter contains no farm or member fixtures", () => {
  assert.doesNotMatch(carryForward, /6a503d9f|23e98e5e|5eba786d|4cd799e2/i);
});
