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

test("Clock Day lab exposes the one-page-scroll Clock study with an alternate Day rail", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Real-Atlas Clock \+ alternate Day rail/);
  assert.match(study, /Clock owns the schedule, but the page owns the scroll\./);
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

test("date header owns the compact Clock Day toggle and duplicate progress text is removed", () => {
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
  assert.match(contract, /toggle belongs in the date header where the old task-count block sat/);
});

test("smart rail is restrained: hairline progress, neutral task dots, purple NOW", () => {
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

test("UNLOCKS is a robust branch instead of Holding or a missed-window badge", () => {
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

test("Clock uses the document scroll instead of a nested scroll viewport", () => {
  assert.match(study, /window\.addEventListener\("scroll", observePageScroll/);
  assert.match(study, /getBoundingClientRect\(\)/);
  assert.match(study, /window\.innerHeight \/ 2/);
  assert.match(study, /scrollIntoView\(\{ behavior, block: "center" \}\)/);
  assert.doesNotMatch(study, /onScroll=/);
  assert.doesNotMatch(smartCss, /overflow-y:\s*auto/);
  assert.doesNotMatch(smartCss, /scroll-snap-type/);
  assert.match(contract, /`page_scroll_owner = document`/);
  assert.match(contract, /must not create a nested vertical scroll viewport/);
});

test("inspection is neutral while purple remains reserved for factual NOW", () => {
  assert.match(study, /data-inspected={isInspected \? "true" : "false"}/);
  assert.match(study, /data-now={isNow \? "true" : "false"}/);
  assert.match(smartCss, /\.calendarTaskBlock\[data-inspected="true"\][\s\S]*background: #fff/);
  assert.match(smartCss, /\.calendarTaskBlock\[data-now="true"\][\s\S]*border-left: 4px solid #776dca/);
  assert.match(study, /feedNow/);
  assert.match(study, /feedInspected/);
  assert.match(contract, /merely scrolling past or inspecting another task must not turn that task purple/);
});

test("Clock compresses dead time while preserving governed times and durations", () => {
  assert.match(study, /elasticGapHeight/);
  assert.match(study, /Math\.sqrt\(minutes\)/);
  assert.match(study, /elasticTaskHeight/);
  assert.match(study, /Math\.log1p\(minutes\)/);
  assert.match(study, /formatMinutes\(minutes\)/);
  assert.match(study, /data-placement-source={task\.placementSource}/);
  assert.match(contract, /pixel distance in the large Clock is not itself authoritative elapsed time/);
  assert.match(contract, /compact smart rail remains the linear real-time overview/);
});

test("Clock still owns fitting flexible work into the day", () => {
  assert.match(study, /placementSource: "atlas-fit"/);
  assert.match(contract, /A task does not need to originate with an exact clock time to receive one in Clock/);
  assert.match(contract, /There is no worker-facing flexible\/unplanned pocket/);
  assert.match(contract, /that is a \*\*planning conflict\*\*/);
  assert.match(contract, /Clock choreography/);
});

test("yesterday and tomorrow navigation exists at both ends of the day", () => {
  assert.match(study, /<DayNavigation position="top" \/>/);
  assert.match(study, /<DayNavigation position="bottom" \/>/);
  assert.match(study, /‹ Tue 25/);
  assert.match(study, /Thu 27 ›/);
  assert.match(contract, /both the top and bottom/);
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
