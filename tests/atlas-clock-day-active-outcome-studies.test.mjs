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

test("Clock Day lab exposes Atlas day summary plus scrollable temporal index study", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Atlas day summary \+ scrollable temporal index/);
  assert.match(study, /The roller becomes a time index\. The feed remains the work\./);
  assert.match(study, /DaySummaryPanel/);
  assert.match(study, /SmartDayRail/);
  assert.match(study, /ConsequenceRow/);
  assert.match(study, /ScrollableDayIndex/);
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

test("smart progress and consequence state share one current-Atlas-style purple day card", () => {
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
  assert.doesNotMatch(study, /dayInstrument|ConsequenceStrip|consequenceStrip/);
  assert.match(contract, /rail should not live in a separate white capsule/);
  assert.match(contract, /same pale-purple rounded day-summary card/);
});

test("one physical rail carries smart progress, NOW, and task distribution", () => {
  assert.match(study, /SMART_PROGRESS_FRONTIER = 43/);
  assert.match(study, /CURRENT_TIME_POSITION = 69/);
  assert.match(study, /DAY_TASK_POSITIONS = \[6, 13, 21, 29, 38, 47, 55, 64, 72, 84, 94\]/);
  assert.match(study, /smartRailBase/);
  assert.match(study, /smartRailProgress/);
  assert.match(study, /smartRailTaskDot/);
  assert.match(study, /smartRailNowDot/);
  assert.match(study, /smartRailNowLabel/);
  assert.match(study, /4:06 PM/);
  assert.match(smartCss, /\.smartRailBase,/);
  assert.match(smartCss, /\.smartRailProgress/);
  assert.match(smartCss, /\.smartRailTaskDot/);
  assert.match(smartCss, /\.smartRailNowDot/);
  assert.match(smartCss, /height: 4px/);
});

test("smart rail contract keeps raw done count separate from chronological clearance", () => {
  assert.match(contract, /purple fill is not `completed task count \/ total task count`/);
  assert.match(contract, /Day Clearance Frontier/);
  assert.match(contract, /M\(f\) = Σ w_i/);
  assert.match(contract, /D\(f\) = Σ/);
  assert.match(contract, /Q\(f\) = 1 - D\(f\) \/ M\(f\)/);
  assert.match(contract, /three morning tasks remain open, while an 8 PM task was completed early/);
  assert.match(contract, /frontier does not simply leap to 8 PM/);
  assert.match(contract, /An unplaced task receives no fake dot/);
});

test("temporal index is a real vertical snap scrubber rather than a second static roller", () => {
  assert.match(study, /^"use client";/);
  assert.match(study, /useState\(NOW_TASK_INDEX\)/);
  assert.match(study, /SCRUBBER_ROW_HEIGHT = 32/);
  assert.match(study, /onScroll={handleScroll}/);
  assert.match(study, /ArrowUp/);
  assert.match(study, /ArrowDown/);
  assert.match(study, /scrollTo\(\{/);
  assert.match(study, /SCROLL DAY/);
  assert.match(study, /INSPECTING/);
  assert.match(study, /actual NOW remains 4:06 PM/);
  assert.match(smartCss, /overflow-y: auto/);
  assert.match(smartCss, /scroll-snap-type: y mandatory/);
  assert.match(smartCss, /scroll-snap-align: center/);
  assert.match(smartCss, /touch-action: pan-y/);
});

test("scrubber inspection synchronizes identity with the full task feed without moving NOW", () => {
  assert.match(study, /const NOW_TASK_INDEX = 3/);
  assert.match(study, /data-active={isNow \? "true" : "false"}/);
  assert.match(study, /data-inspected={isInspected \? "true" : "false"}/);
  assert.match(study, /feedInspected/);
  assert.match(study, /INSPECTING {task\.time}/);
  assert.match(smartCss, /\.feedInspected/);
  assert.match(contract, /scrubber\.inspected_task_id == task_feed\.inspected_task_id/);
  assert.match(contract, /Scrolling the scrubber never mutates a task, changes a Clock placement, changes NOW, or changes the Day Clearance Frontier/);
  assert.match(contract, /inspecting 7:00 PM/);
  assert.match(contract, /not claiming that it is 7:00 PM/);
});

test("scrubber has a distinct purpose from the detailed task feed and its location stays provisional", () => {
  assert.match(contract, /vertical roller is not a second task feed/);
  assert.match(contract, /regular task feed remains the detailed work surface/);
  assert.match(contract, /Past tasks remain inspectable; future tasks remain inspectable/);
  assert.match(contract, /Unplaced work does not receive an invented scrubber position/);
  assert.match(contract, /Passive page scrolling alone should not continually rewrite scrubber inspection state/);
  assert.match(contract, /Scrubber placement is still provisional/);
  assert.match(study, /scrubber location is intentionally provisional/);
});

test("consequence selector remains independent and governed", () => {
  assert.match(study, /SLIPPED_OUTCOME_TASK/);
  assert.match(study, /family: "TIDY"/);
  assert.match(study, /title: "Farmhouse"/);
  assert.match(study, /Thursday Ticketed Night · Aug 27/);
  assert.match(contract, /real dependency\/unlock edge/);
  assert.match(contract, /hard date or fixed event/);
  assert.match(contract, /Never manufacture consequence importance from display prose/);
  assert.match(contract, /If there is no unresolved task with a governed consequence, the divider and consequence row should be absent/);
  assert.match(contract, /Inspected task/);
  assert.match(contract, /must not collapse them into one `activeTask` variable/);
});

test("all incomplete tasks remain fully represented on the detailed task rail", () => {
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
