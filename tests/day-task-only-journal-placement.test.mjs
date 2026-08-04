import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const day = read("app/day/page.tsx");
const dayCss = read("app/day-task-only.css");
const journal = read("app/journal/page.tsx");
const journalCss = read("app/journal-page.css");
const month = read("app/overview/month/page.tsx");
const layout = read("app/layout.tsx");

test("Day remains one task timeline while Living Journal sections are visually absent", () => {
  assert.match(day, /atlas-day-route-spine/);
  assert.match(day, /atlas-day-mixed-timeline/);
  assert.match(day, /windowedTimeline\(timelineGroups\)/);
  assert.match(dayCss, /\.atlas-day-browse \.atlas-journal-carried/);
  assert.match(dayCss, /\.atlas-day-browse \.atlas-journal-goals/);
  assert.match(dayCss, /\.atlas-day-browse \.atlas-journal-events/);
  assert.match(dayCss, /\.atlas-day-browse \.atlas-journal-unlocked/);
  assert.match(dayCss, /\.atlas-day-browse \.atlas-journal-completion-summary/);
  assert.match(dayCss, /\.atlas-day-browse \.atlas-day-complete-drawer/);
  assert.match(dayCss, /display: none !important/);
});

test("Day mixes every unfinished carry-forward task into the signed-in viewer's real day", () => {
  assert.match(day, /const overdueTasks = useMemo/);
  assert.match(day, /task\.due_date < dateIso/);
  assert.match(day, /mixedOpenTasks/);
  assert.match(day, /\.\.\.overdueTasks, \.\.\.requiredTasks/);
  assert.match(day, /mixedDaySortValue/);
  assert.match(day, /isOverdueTask\(task, dateIso\)/);
  assert.doesNotMatch(day, /atlas-day-overdue-group/);
  assert.doesNotMatch(day, /isOwnerOnlyTask/);
});

test("completed work collapses to a dot and faint one-line title", () => {
  assert.match(dayCss, /min-height: 18px !important/);
  assert.match(dayCss, /height: 18px/);
  assert.match(dayCss, /font-size: 9px/);
  assert.match(dayCss, /rgba\(111, 114, 104, 0\.58\)/);
  assert.match(dayCss, /summary span[\s\S]*summary b[\s\S]*> div[\s\S]*display: none !important/);
  assert.match(day, /atlas-day-completion-echo/);
  assert.match(day, /aria-label=\{`Uncomplete \$\{label\}`\}/);
});

test("goals and canonical change history have a dedicated Farm Journal route", () => {
  assert.match(journal, /Farm Journal/);
  assert.match(journal, /<LivingDayCarried/);
  assert.match(journal, /<LivingDayGoals/);
  assert.match(journal, /<LivingDayJournal/);
  assert.match(journal, /<LivingDayUnlocked/);
  assert.match(journal, /<LivingDayCompletionSummary/);
  assert.match(journal, /The Day page stays a clean task list/);
  assert.match(journalCss, /atlas-journal-page-intro/);
});

test("Month overview is the visible doorway to the Farm Journal", () => {
  assert.match(month, /href=\{`\/journal\?date=\$\{encodeURIComponent\(anchorIso\)\}`\}/);
  assert.match(month, /aria-label="Open Farm Journal"/);
  assert.match(layout, /import "\.\/journal-page\.css"/);
  assert.match(layout, /import "\.\/day-task-only\.css"/);
});
