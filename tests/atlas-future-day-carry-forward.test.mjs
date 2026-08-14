import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

test("carried-work labeling stays on Today while each future Day trusts its canonical dated Worker Day feed", () => {
  assert.match(dayPage, /const calendarToday = todayIso\(\);/);
  assert.match(dayPage, /const isFutureDay = dateIso > calendarToday;/);
  assert.match(dayPage, /if \(dateIso !== calendarToday\) return \[\];/);
  assert.match(dayPage, /useAtlasWorkerDayProjection\(dateIso\)/);
  assert.doesNotMatch(dayPage, /fetchAtlasTaskCards/);
  assert.match(dayPage, /task\.due_date < dateIso/);
  assert.match(dayPage, /const mixedOpenTasks = useMemo\(\(\) => uniqueTasks\(requiredTasks\), \[requiredTasks\]\);/);
  assert.match(dayPage, /Unfinished work from earlier days is still real/);
  assert.match(dayPage, /windowedTimeline\(visibleTimelineGroups\)/);
  assert.match(dayPage, /label: "Morning"/);
  assert.match(dayPage, /label: "Afternoon"/);
  assert.match(dayPage, /label: "Evening"/);
  assert.doesNotMatch(dayPage, /relativeWorkerTimelineGroups/);
  assert.match(dayPage, /atlas-day-mixed-timeline/);
  assert.match(dayPage, /tasks scheduled for this day/);
  assert.doesNotMatch(dayPage, /These unfinished tasks remain ahead of today’s regular work/);
});
