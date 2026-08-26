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
const shell = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const globalHeaderCss = read("app/global-atlas-header.css");

test("Clock Day lab exposes the bounded focus-context Clock study with an alternate Day rail", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Bounded Clock scrubber \+ alternate Day rail/);
  assert.match(study, /Clock stays bounded\. Only its scrubber moves\./);
  assert.match(study, /DaySummaryPanel/);
  assert.match(study, /ViewToggle/);
  assert.match(study, /CalendarClockView/);
  assert.match(study, /OrderedTaskRail/);
});

test("study remains fixture-only and cannot touch Worker state", () => {
  assert.match(study, /data-atlas-active-outcome-studies="fixture-only"/);
  assert.match(study, /data-live-task-binding="none"/);
  assert.match(study, /data-task-transition-capability="none"/);
  assert.doesNotMatch(study, /fetch\s*\(/);
  assert.doesNotMatch(study, /\/api\/atlas\//);
  assert.doesNotMatch(study, /createAtlasServerClient|@supabase\/|useAtlasWorkerDayProjection|postAtlasTaskTransition/i);
  assert.doesNotMatch(study, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("date header owns the compact Clock Day toggle and duplicate progress text stays removed", () => {
  assert.match(study, /function DayHeader\(\{ view, onChange \}/);
  assert.match(study, /<ViewToggle view={view} onChange={onChange} \/>/);
  assert.match(study, /useState<DayView>\("clock"\)/);
  assert.match(study, />Clock<\/button>/);
  assert.match(study, />Day<\/button>/);
  assert.doesNotMatch(study, /6 OF 11 FINISHED/);
  assert.doesNotMatch(study, /11 tasks/);
  assert.doesNotMatch(study, /WINDOW/);
  assert.doesNotMatch(study, /00:18/);
  assert.doesNotMatch(study, /dayCount/);
  assert.match(smartCss, /\.viewToggle/);
  assert.match(contract, /toggle belongs in the date header/);
});

test("smart rail stays restrained: hairline progress, neutral task dots, purple NOW", () => {
  assert.match(study, /SMART_PROGRESS_FRONTIER = 43/);
  assert.match(study, /CURRENT_TIME_POSITION = 69/);
  assert.match(study, /DAY_TASK_POSITIONS = \[6, 13, 21, 29, 38, 47, 55, 64, 72, 84, 94\]/);
  assert.match(smartCss, /\.smartRailBase[\s\S]*height: 1px/);
  assert.match(smartCss, /\.smartRailProgress[\s\S]*height: 2px/);
  assert.match(smartCss, /\.smartRailTaskDot[\s\S]*width: 7px;[\s\S]*height: 7px;[\s\S]*background: #b8bac3/);
  assert.match(smartCss, /\.smartRailNowDot[\s\S]*border: 2px solid #776dca/);
  assert.match(contract, /only purple event marker on the rail/);
});

test("smart rail keeps raw completion count separate from chronological clearance math", () => {
  assert.match(contract, /fill is not `completed task count \/ total task count`/);
  assert.match(contract, /Day Clearance Frontier/);
  assert.match(contract, /M\(f\) = Σ w_i/);
  assert.match(contract, /D\(f\) = Σ/);
  assert.match(contract, /Q\(f\) = 1 - D\(f\) \/ M\(f\)/);
  assert.match(contract, /three morning tasks remain open while an 8 PM task was completed early/);
  assert.match(contract, /later completion cannot erase earlier chronological debt/);
});

test("UNLOCKS remains a robust branch instead of Holding or a missed-window badge", () => {
  assert.match(study, /consequenceSource/);
  assert.match(study, /STILL OPEN/);
  assert.match(study, /consequenceUnlock/);
  assert.match(study, />UNLOCKS<\/span>/);
  assert.match(study, /Thursday Ticketed Night · Aug 27/);
  assert.doesNotMatch(study, /Holding/);
  assert.doesNotMatch(study, /MISSED WINDOW/);
  assert.match(smartCss, /\.consequenceUnlock strong[\s\S]*white-space: normal/);
  assert.match(contract, /product vocabulary is \*\*UNLOCKS\*\*, not `Holding`/);
  assert.match(contract, /full downstream task\/event name, allowed to wrap to multiple lines/);
});

test("Clock screen is bounded and the scrubber starts below Return to now", () => {
  assert.match(study, /boundedPhone/);
  assert.match(study, /boundedDaySurface/);
  assert.match(study, /<button type="button" disabled={inspectingNow} onClick=\{\(\) => settleOn\(NOW_TASK_INDEX\)\}>Return to now<\/button>/);
  assert.match(study, /className={smartStyles\.clockLensViewport}/);
  assert.match(smartCss, /\.boundedPhone[\s\S]*height: 820px[\s\S]*grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(smartCss, /\.boundedDaySurface\[data-view="clock"\][\s\S]*overflow: hidden/);
  assert.match(smartCss, /\.clockView[\s\S]*grid-template-rows: auto minmax\(0, 1fr\)[\s\S]*overflow: hidden/);
  assert.match(smartCss, /\.clockLensViewport[\s\S]*overflow: hidden[\s\S]*touch-action: none/);
  assert.match(contract, /scrubber begins immediately below that header/);
  assert.match(contract, /`clock_scroll_owner = bounded_scrubber`/);
});

test("Clock scrubber captures wheel touch and keyboard inspection without page-scroll listeners", () => {
  assert.match(study, /onWheel={handleWheel}/);
  assert.match(study, /onTouchStart={handleTouchStart}/);
  assert.match(study, /onTouchMove={handleTouchMove}/);
  assert.match(study, /onKeyDown={handleKeyDown}/);
  assert.match(study, /ArrowDown/);
  assert.match(study, /ArrowUp/);
  assert.match(study, /role="slider"/);
  assert.doesNotMatch(study, /window\.addEventListener\("scroll"/);
  assert.doesNotMatch(study, /scrollIntoView/);
  assert.match(contract, /wheel, swipe, arrow key, or direct task tap inside the scrubber changes the inspected focus/);
});

test("focus-context lens keeps every task represented while allocating more space near inspection", () => {
  assert.match(study, /function chronicleFocusWeight\(distance: number\)/);
  assert.match(study, /if \(distance === 0\) return 4\.2/);
  assert.match(study, /return 0\.78/);
  assert.match(study, /TASKS\.map\(\(task, index\) =>/);
  assert.match(study, /style=\{\{ flexGrow: weight \}\}/);
  assert.match(study, /focusDistanceTier/);
  assert.match(smartCss, /\.clockLensRow[\s\S]*flex-basis: 0[\s\S]*min-height: 0/);
  assert.match(contract, /`z_floor > 0` guarantees distant tasks remain represented/);
  assert.match(contract, /never by deleting the beginning or end of the scheduled day/);
  assert.match(contract, /first and last scheduled tasks must remain visibly represented/);
});

test("inspection remains neutral while purple stays reserved for factual NOW", () => {
  assert.match(study, /data-inspected={isInspected \? "true" : "false"}/);
  assert.match(study, /data-now={isNow \? "true" : "false"}/);
  assert.match(smartCss, /\.calendarTaskBlock\[data-inspected="true"\][\s\S]*background: #fff/);
  assert.match(smartCss, /\.calendarTaskBlock\[data-now="true"\][\s\S]*border-left: 4px solid #776dca/);
  assert.match(study, /feedNow/);
  assert.match(study, /feedInspected/);
  assert.match(contract, /merely scrubbing to or inspecting another task must not turn that task purple/);
});

test("bounded lens keeps governed times authoritative instead of literal pixel-time geometry", () => {
  assert.match(study, /minuteOfDay/);
  assert.match(study, /durationMinutes/);
  assert.match(study, /data-placement-source={task\.placementSource}/);
  assert.match(contract, /does not assign equal pixels to equal minutes/);
  assert.match(contract, /pixel distance and row height inside the bounded lens are not authoritative elapsed time/);
  assert.match(contract, /compact smart rail remains the linear real-time overview/);
});

test("Clock still owns fitting flexible work into the day", () => {
  assert.match(study, /placementSource: "atlas-fit"/);
  assert.match(contract, /A task does not need to originate with an exact clock time to receive one in Clock/);
  assert.match(contract, /There is no worker-facing flexible\/unplanned pocket/);
  assert.match(contract, /that is a \*\*planning conflict\*\*/);
  assert.match(contract, /Clock choreography/);
});

test("yesterday and tomorrow navigation remains outside the scrubber at both ends of the day", () => {
  assert.match(study, /<DayNavigation position="top" \/>/);
  assert.match(study, /<DayNavigation position="bottom" \/>/);
  assert.match(study, /‹ Tue 25/);
  assert.match(study, /Thu 27 ›/);
  assert.match(contract, /both the top and bottom/);
  assert.match(contract, /remain outside the scrubber/);
});

test("shared Atlas shell keeps + on Home and gives every other route a governed exit X", () => {
  assert.match(shell, /usePathname, useSearchParams/);
  assert.match(shell, /safeInternalReturnTo/);
  assert.match(shell, /pathname\.startsWith\("\/task"\)/);
  assert.match(shell, /if \(pathname === "\/more"\) return "\/"/);
  assert.match(shell, /if \(active === "more"\) return "\/more"/);
  assert.match(shell, /const headerAction = active === "home"/);
  assert.match(shell, /aria-label="Document work"/);
  assert.match(shell, /className="atlas-global-note-plus atlas-global-exit"/);
  assert.match(shell, />×<\/Link>/);
  assert.match(globalHeaderCss, /\.atlas-global-exit/);
  assert.match(contract, /implemented once in the shared Atlas shell/);
});

test("Clock and Day share inspected identity while the detailed Day rail remains complete", () => {
  assert.match(study, /<CalendarClockView inspectedIndex={inspectedIndex} onInspect={setInspectedIndex} \/>/);
  assert.match(study, /<OrderedTaskRail inspectedIndex={inspectedIndex} \/>/);
  assert.match(contract, /clock\.inspected_task_id == day_feed\.inspected_task_id/);
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
});
