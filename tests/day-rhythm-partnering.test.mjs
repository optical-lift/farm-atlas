import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("overdue work partners with today's matching operational family", () => {
  const page = read("app/day/page.tsx");
  const route = read("lib/atlas/day-route.ts");

  assert.match(route, /spray: "Spray"/);
  assert.match(route, /respray: "Spray"/);
  assert.match(route, /export function atlasDayTaskPartnerKey/);
  assert.match(route, /work_partner_key/);
  assert.match(route, /atlasDayTaskFamily\(task\)/);
  assert.doesNotMatch(route, /atlasDayTaskPartnerKey[\s\S]*task\.title/);

  assert.match(page, /buildDayPartnerPlan/);
  assert.match(page, /resolvedDayWindowForTask/);
  assert.match(page, /resolvedWorkOrderNumber/);
  assert.match(page, /const partnerPlan = useMemo/);
  assert.match(page, /allDayTasks\.filter\(\(task\) => !isExtraCredit\(task\)\)/);
  assert.match(page, /overdueTasks\.filter\(\(task\) => resolvedDayWindowForTask/);
  assert.match(page, /filteredTimelineTasks\.filter\(\(task\) => resolvedDayWindowForTask/);
  assert.match(page, /mixedDaySortValue\(a, dateIso, partnerPlan\)/);
});

test("partnering changes presentation order without rewriting task dates", () => {
  const page = read("app/day/page.tsx");

  assert.match(page, /task\.due_date === selectedDay \|\| isOverdueTask\(task, selectedDay\)/);
  assert.doesNotMatch(page, /task\.due_date\s*=(?!=)/);
  assert.doesNotMatch(page, /update.*due_date/i);
  assert.doesNotMatch(page, /title\.toLowerCase\(\).*partner/i);
});
