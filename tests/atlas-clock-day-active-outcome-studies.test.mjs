import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const study = read("app/owner/clock-day-lab/ActiveOutcomeStudies.tsx");
const css = read("app/owner/clock-day-lab/active-outcome-studies.module.css");
const smartCss = read("app/owner/clock-day-lab/smart-day-study.module.css");
const contract = read("docs/architecture/clock-day-smart-rail-and-consequence-contract.md");

test("Clock Day lab exposes a Clock-first calendar scrubber with a secondary Day rail", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Clock-first calendar scrubber \+ Day rail toggle/);
  assert.match(study, /Clock schedules the day\. Day shows the whole work rail\./);
  assert.match(study, /DaySummaryPanel/);
  assert.match(study, /ViewToggle/);
  assert.match(study, /CalendarClockView/);
  assert.match(study, /OrderedTaskRail/);
});

test("study remains fixture-only and cannot touch worker state", () => {
  assert.match(study, /data-atlas-active-outcome-studies="fixture-only"/);
  assert.match(study, /data-live-task-binding="none"/);
  assert.match(study, /data-task-transition-capability="none"/);
  assert.doesNotMatch(study, /fetch\s*\(/);
  assert.doesNotMatch(study, /\/api\/atlas\//);
  assert.doesNotMatch(study, /createAtlasServerClient|@supabase\/|useAtlasWorkerDayProjection|postAtlasTaskTransition/i);
  assert.doesNotMatch(study, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("smart progress and consequence state remain one current-Atlas-style purple day card", () => {
  assert.match(study, /DaySummaryPanel/);
  assert.match(study, /6 OF 11 FINISHED/);
  assert.match(study, /WINDOW/);
  assert.match(study, /00:18/);
  assert.match(study, /ConsequenceRow/);
  assert.match(study, /MISSED WINDOW/);
  assert.match(study, /Holding/);
  assert.match(smartCss, /\.daySummaryPanel/);
  assert.match(smartCss, /background: #f3f4fb/);
  assert.match(smartCss, /\.daySummaryDivider/);
  assert.match(smartCss, /\.consequenceRow/);
  assert.match(contract, /rail must not live in a separate white capsule/);
  assert.match(contract, /current Atlas Work day card/);
});

test("smart rail uses a skinny progress line with larger filled task dots and a larger NOW marker", () => {
  assert.match(study, /SMART_PROGRESS_FRONTIER = 43/);
  assert.match(study, /CURRENT_TIME_POSITION = 69/);
  assert.match(study, /DAY_TASK_POSITIONS = \[6, 13, 21, 29, 38, 47, 55, 64, 72, 84, 94\]/);
  assert.match(study, /smartRailBase/);
  assert.match(study, /smartRailProgress/);
  assert.match(study, /smartRailTaskDot/);
  assert.match(study, /smartRailNowDot/);
  assert.match(smartCss, /\.smartRailBase,/);
  assert.match(smartCss, /height: 2px/);
  assert.match(smartCss, /\.smartRailTaskDot[\s\S]*width: 8px;[\s\S]*height: 8px/);
  assert.match(smartCss, /\.smartRailNowDot[\s\S]*width: 16px;[\s\S]*height: 16px/);
  assert.match(contract, /larger faint filled circle whose diameter visibly overhangs the rail/);
});

test("smart rail contract keeps raw done count separate from chronological clearance", () => {
  assert.match(contract, /purple fill is not `completed task count \/ total task count`/);
  assert.match(contract, /Day Clearance Frontier/);
  assert.match(contract, /M\(f\) = Σ w_i/);
  assert.match(contract, /D\(f\) = Σ/);
  assert.match(contract, /Q\(f\) = 1 - D\(f\) \/ M\(f\)/);
  assert.match(contract, /three morning tasks remain open, while an 8 PM task was completed early/);
  assert.match(contract, /frontier does not simply leap to 8 PM/);
});

test("Clock is the default viewer and Day remains an explicit alternate view", () => {
  assert.match(study, /type DayView = "clock" \| "day"/);
  assert.match(study, /useState<DayView>\("clock"\)/);
  assert.match(study, />Clock<\/button>/);
  assert.match(study, />Day<\/button>/);
  assert.match(study, /view === "clock"/);
  assert.match(smartCss, /\.viewToggle/);
  assert.match(contract, /\*\*Clock\*\* — default/);
  assert.match(contract, /\*\*Day\*\* — secondary toggle/);
});

test("Clock is a plain time-proportional calendar with scrub behavior", () => {
  assert.match(study, /CALENDAR_START_MINUTE = 7 \* 60/);
  assert.match(study, /CALENDAR_END_MINUTE = 20 \* 60/);
  assert.match(study, /CALENDAR_PX_PER_MINUTE/);
  assert.match(study, /minuteOfDay/);
  assert.match(study, /durationMinutes/);
  assert.match(study, /calendarY\(task\.minuteOfDay\)/);
  assert.match(study, /taskBlockHeight\(task\)/);
  assert.match(study, /onScroll={handleScroll}/);
  assert.match(study, /ArrowUp/);
  assert.match(study, /ArrowDown/);
  assert.match(study, /Return to now/);
  assert.match(smartCss, /\.calendarViewport/);
  assert.match(smartCss, /overflow-y: auto/);
  assert.match(smartCss, /scroll-snap-type: y proximity/);
  assert.match(smartCss, /\.calendarHour/);
  assert.match(smartCss, /\.calendarTaskBlock/);
  assert.match(smartCss, /\.calendarNow/);
  assert.match(contract, /vertical time-proportional axis with hour labels and faint horizontal rules/);
  assert.match(contract, /Fancy curvature, wheel distortion, perspective, and watch-face styling are deferred/);
});

test("Clock owns fitting flexible work into the worker day instead of leaving an unplanned pocket", () => {
  assert.match(study, /placementSource: "atlas-fit"/);
  assert.match(study, /data-placement-source={task\.placementSource}/);
  assert.match(study, /Clock is allowed to place flexible work into the worker day/);
  assert.match(contract, /A task does not need to originate with an exact clock time in order to receive one in Clock/);
  assert.match(contract, /Clock should assign a usable day placement/);
  assert.match(contract, /No flexible-unplanned pocket in the worker Clock/);
  assert.match(contract, /that is a \*\*planning conflict\*\*/);
  assert.match(contract, /Clock choreography truth/);
});

test("calendar scrub keeps factual NOW independent from the inspected focal task", () => {
  assert.match(study, /const NOW_TASK_INDEX = 3/);
  assert.match(study, /const NOW_MINUTE = 16 \* 60 \+ 6/);
  assert.match(study, /calendarNow/);
  assert.match(study, /INSPECTING ·/);
  assert.match(study, /inspectedIndex === NOW_TASK_INDEX/);
  assert.match(contract, /the nearest scheduled task becomes the inspected focal block/);
  assert.match(contract, /the factual NOW line does not move/);
  assert.match(contract, /focused\/inspected` and `NOW` remain separate/);
});

test("Clock and Day share inspected task identity without sharing presentation grammar", () => {
  assert.match(study, /<CalendarClockView inspectedIndex={inspectedIndex} onInspect={setInspectedIndex} \/>/);
  assert.match(study, /<OrderedTaskRail inspectedIndex={inspectedIndex} \/>/);
  assert.match(study, /data-inspected={isInspected \? "true" : "false"}/);
  assert.match(study, /feedInspected/);
  assert.match(contract, /clock\.inspected_task_id == day_feed\.inspected_task_id/);
  assert.match(contract, /Clock remains the temporal scheduler\/orientation surface/);
  assert.match(contract, /Day view remains the detailed work surface/);
});

test("consequence selector remains independent and governed", () => {
  assert.match(study, /SLIPPED_OUTCOME_TASK/);
  assert.match(study, /family: "TIDY"/);
  assert.match(study, /title: "Farmhouse"/);
  assert.match(study, /Thursday Ticketed Night · Aug 27/);
  assert.match(contract, /real dependency\/unlock edge/);
  assert.match(contract, /hard date or fixed event/);
  assert.match(contract, /Never manufacture consequence importance from display prose/);
  assert.match(contract, /If there is no unresolved task with a governed consequence/);
  assert.match(contract, /must not collapse them into one `activeTask` variable/);
});

test("secondary Day view retains the complete detailed task rail fixture", () => {
  assert.match(css, /\.cleanRail::before/);
  assert.match(css, /\.cleanNode/);

  for (const token of [
    "STEWARDSHIP",
    "Farm Round · Elm Farm",
    "WEED",
    "MG11",
    "Main Garden",
    "30 min · Heavy",
    "TIDY",
    "Farmhouse",
    "Interior",
    "20 min · Standard",
    "POT UP",
    "Sweet William",
    "Grow Room",
    "3 trays · 600 plants",
    "SPRAY",
    "BB10 · Bermuda Pass 1",
    "Barn Beds",
    "20 min · Pass 1 of 3",
  ]) assert.match(study, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(study, /TaskIdentity/);
  assert.match(study, /task\.place} · {task\.amount/);
  assert.match(css, /\.railDot/);
  assert.match(css, /\.unlockBranch/);
});
