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

test("Clock Day lab exposes the silent-intelligence stress study on the bounded Clock", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Silent-intelligence Clock \+ synchronized Day rail/);
  assert.match(study, /More Atlas underneath\. Less Atlas on the screen\./);
  assert.match(study, /SILENT INTELLIGENCE STRESS TEST/);
  assert.match(study, /DaySummaryPanel/);
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
  assert.doesNotMatch(study, /WINDOW 00:18/);
  assert.doesNotMatch(study, /00:18/);
  assert.match(contract, /toggle belongs in the date header/);
});

test("smart rail stays restrained and derives visible dots from the current projection", () => {
  assert.match(study, /SMART_PROGRESS_FRONTIER = 43/);
  assert.match(study, /CURRENT_TIME_POSITION = 69/);
  assert.match(study, /tasksForScope\(scope\)\.map\(\(task\) =>/);
  assert.match(study, /task\.railPosition/);
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
  assert.match(contract, /later completion cannot erase earlier chronological debt/);
});

test("UNLOCKS remains a robust ranked consequence path", () => {
  assert.match(study, /consequencePriority/);
  assert.match(study, /consequentialTaskForScope/);
  assert.match(study, /unlockPath: \["Thursday Ticketed Night · Aug 27", "Venue ready"\]/);
  assert.match(study, /<span>UNLOCKS<\/span>/);
  assert.match(study, /rest\.map\(\(target\) => `→ \$\{target\}`\)/);
  assert.doesNotMatch(study, /Holding/);
  assert.doesNotMatch(study, /MISSED WINDOW/);
  assert.match(smartCss, /\.consequenceUnlock strong[\s\S]*white-space: normal/);
  assert.match(contract, /product vocabulary is \*\*UNLOCKS\*\*, not `Holding`/);
});

test("Clock screen stays bounded and only the scrubber owns temporal inspection", () => {
  assert.match(study, /boundedPhone/);
  assert.match(study, /boundedDaySurface/);
  assert.match(study, />Return to now<\/button>/);
  assert.match(study, /className={smartStyles\.clockLensViewport}/);
  assert.match(smartCss, /\.boundedPhone[\s\S]*height: 820px/);
  assert.match(smartCss, /\.boundedDaySurface\[data-view="clock"\][\s\S]*overflow: hidden/);
  assert.match(smartCss, /\.clockLensViewport[\s\S]*overflow: hidden[\s\S]*touch-action: none/);
  assert.match(contract, /scrubber begins immediately below that header/);
  assert.match(contract, /`clock_scroll_owner = bounded_scrubber`/);
});

test("Clock scrubber captures wheel touch and keyboard inspection without document-scroll listeners", () => {
  assert.match(study, /onWheel={handleWheel}/);
  assert.match(study, /onTouchStart={handleTouchStart}/);
  assert.match(study, /onTouchMove={handleTouchMove}/);
  assert.match(study, /onKeyDown={handleKeyDown}/);
  assert.match(study, /ArrowDown/);
  assert.match(study, /ArrowUp/);
  assert.match(study, /role="slider"/);
  assert.doesNotMatch(study, /window\.addEventListener\("scroll"/);
  assert.doesNotMatch(study, /scrollIntoView/);
});

test("focus-context lens keeps every visible task represented while focus earns more room", () => {
  assert.match(study, /function chronicleFocusWeight\(distance: number\)/);
  assert.match(study, /if \(distance === 0\) return 4\.2/);
  assert.match(study, /return 0\.78/);
  assert.match(study, /tasks\.map\(\(task, index\) =>/);
  assert.match(study, /style=\{\{ flexGrow: weight \}\}/);
  assert.match(study, /focusDistanceTier/);
  assert.match(smartCss, /\.clockLensSequence[\s\S]*display: contents/);
  assert.match(smartCss, /\.clockLensRow[\s\S]*flex-basis: 0[\s\S]*min-height: 0/);
  assert.match(contract, /`z_floor > 0` guarantees distant tasks remain represented/);
  assert.match(contract, /never by deleting the beginning or end of the scheduled day/);
});

test("purple remains factual NOW while inspection and manager filtering stay neutral", () => {
  assert.match(study, /NOW_TASK_ID = "sweet-william-pot-up"/);
  assert.match(study, /data-inspected={isInspected \? "true" : "false"}/);
  assert.match(study, /data-now={isNow \? "true" : "false"}/);
  assert.match(smartCss, /\.calendarTaskBlock\[data-inspected="true"\][\s\S]*background: #fff/);
  assert.match(smartCss, /\.calendarTaskBlock\[data-now="true"\][\s\S]*border-left: 4px solid #776dca/);
  assert.match(contract, /merely scrubbing to or inspecting another task must not turn that task purple/);
});

test("manager Mine Team scope filters projections without creating another task set", () => {
  assert.match(study, /type FeedScope = "mine" \| "team"/);
  assert.match(study, /useState<FeedScope>\("team"\)/);
  assert.match(study, /function tasksForScope\(scope: FeedScope\)/);
  assert.match(study, /scope === "team" \? TASKS : TASKS\.filter\(\(task\) => task\.actor === "You"\)/);
  assert.match(study, /MANAGER FEED/);
  assert.match(study, />Mine<\/button>/);
  assert.match(study, />Team<\/button>/);
  assert.match(smartCss, /\.managerScopeLine/);
  assert.match(contract, /task_id is invariant across Clock, Day, Task Focus, Manager, Mine, Team/);
});

test("checklist completion is a ranked tiny task-health signal rather than a duplicate checklist", () => {
  assert.match(study, /type TaskHealth/);
  assert.match(study, /taskHealth: \{ done: 5, total: 6, noun: "stops" \}/);
  assert.match(study, /taskHealth: \{ done: 6, total: 8, noun: "beds" \}/);
  assert.match(study, /compact: `\$\{health\.done\}\/\$\{health\.total\}`/);
  assert.match(study, /detail: `\$\{health\.done\} of \$\{health\.total\} \$\{health\.noun\}`/);
  assert.match(smartCss, /\.clockSignalLine\[data-focus-tier="context"\]/);
  assert.match(contract, /Real checklist\/child completion must project as one cross-view task-health signal/);
});

test("progressive task signal has a hard admission budget and avoids task-card clutter", () => {
  assert.match(study, /type SignalKind = "progress" \| "readiness" \| "consequence" \| "context"/);
  assert.match(study, /function progressiveSignals\(task: TaskDatum\)/);
  assert.match(study, /function signalsForTier\(task: TaskDatum, tier: FocusTier\)/);
  assert.match(study, /if \(tier === "near"\) return ranked\.slice\(0, 1\)/);
  assert.match(study, /return withoutDuplicatedConsequence\.slice\(0, 2\)/);
  assert.match(study, /candidate\.kind !== "consequence"/);
  assert.match(smartCss, /\.clockSignalLine/);
  assert.match(contract, /Clock admits at most the smallest facts/);
  assert.match(contract, /Specialized task-card detail remains in Task Focus/);
});

test("Occupied Time appears as a neutral non-task scheduling object", () => {
  assert.match(study, /type OccupiedTime/);
  assert.match(study, /Supplier delivery window/);
  assert.match(study, /Mary pickup/);
  assert.match(study, /Vendor call/);
  assert.match(study, /function OccupiedLensRow/);
  assert.match(study, /function OccupiedDayRow/);
  assert.match(study, /OCCUPIED TIME/);
  assert.match(smartCss, /\.occupiedLensRow/);
  assert.match(smartCss, /\.occupiedDayRow/);
  assert.match(contract, /`occupied_time != task`/);
});

test("fixture carries generalized work-context lifecycle and operating-condition outputs without new dashboards", () => {
  assert.match(study, /workContext: "Field route"/);
  assert.match(study, /workContext: "Venue prep"/);
  assert.match(study, /lifecycleState: "FOLLOW-UP DUE"/);
  assert.match(study, /lifecycleState: "EVENT TOMORROW"/);
  assert.match(study, /lifecycleState: "HARVEST WINDOW"/);
  assert.match(study, /operatingCondition: "BUSINESS HOURS"/);
  assert.match(study, /operatingCondition: "COOL WINDOW"/);
  assert.match(study, /operatingCondition: "LOW WIND"/);
  assert.match(contract, /Work Context may be physical place, customer\/account, project/);
  assert.match(contract, /Weather is one member of a broader Operating Conditions primitive/);
});

test("carried-work provenance and end-of-day migration appear only as compact fixture outputs", () => {
  assert.match(study, /migrationOrigin: "Tue"/);
  assert.match(study, /compact: `↳ \$\{intelligence\.migrationOrigin\}`/);
  assert.match(study, /CLOSEOUT_FIXTURES/);
  assert.match(study, /NEEDS MANAGER/);
  assert.match(study, /REVIEW CARRY/);
  assert.match(study, /→ THU/);
  assert.match(study, /showCloseout = inspectedIndex === tasks\.length - 1/);
  assert.match(study, /END-OF-DAY PREVIEW/);
  assert.match(smartCss, /\.closeoutMoment/);
  assert.match(contract, /End-of-day migration is adjudication, not rollover/);
});

test("Clock still owns fitting flexible work into the day without production wiring", () => {
  assert.match(study, /placementSource: "atlas-fit"/);
  assert.match(study, /placementSource: "fixed"/);
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

test("Clock and Day share inspected task identity while rendering the same fixture task objects", () => {
  assert.match(study, /<CalendarClockView scope={scope} inspectedTaskId={inspectedTaskId} onInspect={setInspectedTaskId} \/>/);
  assert.match(study, /<OrderedTaskRail scope={scope} inspectedTaskId={inspectedTaskId} \/>/);
  assert.match(contract, /clock\.inspected_task_id == day_feed\.inspected_task_id/);
  assert.match(css, /\.cleanRail::before/);
  assert.match(css, /\.cleanNode/);

  for (const token of [
    "Farm Round · Elm Farm",
    "Call Marshfield businesses",
    "MG11",
    "String U-Pick arches",
    "Weekly stems",
    "Farmhouse",
    "Confirm Thursday ticket counts",
    "Sweet William",
    "North Lawn",
    "BB10 · Bermuda Pass 1",
  ]) assert.match(study, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
