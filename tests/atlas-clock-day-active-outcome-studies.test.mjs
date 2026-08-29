import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const study = read("app/owner/clock-day-lab/ActiveOutcomeStudies.tsx");
const smartCss = read("app/owner/clock-day-lab/smart-day-study.module.css");
const contract = read("docs/architecture/clock-day-smart-rail-and-consequence-contract.md");
const shell = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const globalHeaderCss = read("app/global-atlas-header.css");

test("Clock Day lab exposes Study 15 as the execution-neighborhood direction", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /CLOCK STUDY 15 · EXECUTION NEIGHBORHOOD/);
  assert.match(study, /Clock keeps custody of the worker&apos;s hands\./);
  assert.match(study, /Day owns the complete service day/);
  assert.match(study, /ExecutionNeighborhood/);
  assert.match(contract, /Study 15 supersedes the prior bounded all-task scrubber/);
});

test("Study 15 remains fixture-only and cannot touch Worker state", () => {
  assert.match(study, /data-atlas-active-outcome-studies="fixture-only"/);
  assert.match(study, /data-live-task-binding="none"/);
  assert.match(study, /data-task-transition-capability="none"/);
  assert.doesNotMatch(study, /fetch\s*\(/);
  assert.doesNotMatch(study, /\/api\/atlas\//);
  assert.doesNotMatch(study, /createAtlasServerClient|@supabase\/|useAtlasWorkerDayProjection|postAtlasTaskTransition/i);
  assert.doesNotMatch(study, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("the full day is reduced to one linear rail with task marks occupied spans and factual NOW", () => {
  assert.match(study, /DAY_START_MINUTE = 8 \* 60/);
  assert.match(study, /DAY_END_MINUTE = 20 \* 60/);
  assert.match(study, /function railPosition\(minute: number\)/);
  assert.match(study, /scenario\.occupied\.map/);
  assert.match(study, /scenario\.railTasks\.map/);
  assert.match(study, /className={smartStyles\.railNowDot}/);
  assert.match(study, /FULL DAY/);
  assert.match(smartCss, /\.dayRailBase[\s\S]*height: 1px/);
  assert.match(smartCss, /\.occupiedSpan[\s\S]*background: #e9e9ec/);
  assert.match(smartCss, /\.railTaskDot[\s\S]*background: #aeb0b8/);
  assert.match(smartCss, /\.railNowDot[\s\S]*border: 2px solid #776dca/);
  assert.match(contract, /The rail remains linear in real elapsed time/);
});

test("Clock body is the immediate LAST NOW NEXT THEN neighborhood rather than the whole Day feed", () => {
  assert.match(study, /type MoveRole = "last" \| "now" \| "next" \| "then"/);
  assert.match(study, /role: "last"/);
  assert.match(study, /role: "now"/);
  assert.match(study, /role: "next"/);
  assert.match(study, /role: "then"/);
  assert.match(study, /NEXT HARD EDGE/);
  assert.match(study, /Day owns everything else/);
  assert.match(contract, /Day proves membership\. Clock proves position\./);
  assert.match(contract, /The projection is intentionally small\. It is not a complete task feed/);
});

test("normal progression keeps the current move dominant without dumping Task Focus detail into Clock", () => {
  assert.match(study, /A · Normal progression/);
  assert.match(study, /title: "Condition \+ bunch flowers"/);
  assert.match(study, /detail: "Zinnias · celosia · lemon basil · sunflowers"/);
  assert.match(study, /title: "Deliver 5 posies"/);
  assert.match(study, /title: "MG7"/);
  assert.match(study, /label: "Pickup at Elm"/);
  assert.match(smartCss, /\.executionMove\[data-role="now"\][\s\S]*min-height: 112px/);
  assert.match(smartCss, /\.executionMove\[data-role="last"\][\s\S]*opacity: 0\.62/);
  assert.match(contract, /Task Focus owns execution detail and result capture/);
});

test("purple remains factual NOW and does not become importance or consequence styling", () => {
  assert.match(smartCss, /\.executionMove\[data-role="now"\][\s\S]*border-left: 4px solid #776dca/);
  assert.match(smartCss, /\.railNowDot[\s\S]*#776dca/);
  assert.doesNotMatch(smartCss, /\.executionMove\[data-role="next"\][\s\S]*#776dca/);
  assert.doesNotMatch(smartCss, /\.temporalConflict[\s\S]*#776dca/);
  assert.match(contract, /Purple keeps one narrow meaning/);
});

test("silent reflow changes choreography while preserving canonical fixture task identity and the hard edge", () => {
  assert.match(study, /B · Reality ran long/);
  assert.match(study, /finished 25 minutes late/);
  assert.match(study, /id: "little-clay-delivery"[\s\S]*minute: 14 \* 60 \+ 15/);
  assert.match(study, /id: "little-clay-delivery"[\s\S]*minute: 14 \* 60 \+ 40/);
  assert.match(study, /id: "weed-mg7"[\s\S]*minute: 15 \* 60/);
  assert.match(study, /id: "weed-mg7"[\s\S]*minute: 15 \* 60 \+ 15/);
  assert.match(study, /startMinute: 16 \* 60 \+ 30/);
  assert.ok((study.match(/id: "little-clay-delivery"/g) ?? []).length >= 4);
  assert.ok((study.match(/id: "weed-mg7"/g) ?? []).length >= 4);
  assert.match(contract, /The schedule just gets better/);
});

test("temporal conflict refuses to manufacture an impossible placement", () => {
  assert.match(study, /C · Temporal conflict/);
  assert.match(study, /title: "MG7 needs 45 min\."/);
  assert.match(study, /22 min remain before Pickup at Elm · 4:30 PM\./);
  assert.match(study, /timeLabel: "Needs placement"/);
  assert.match(study, /options: \["Move after pickup", "Needs manager"\]/);
  assert.match(study, /DAY CONFLICT/);
  assert.doesNotMatch(study, /4:08–4:53 PM/);
  assert.match(contract, /Unfittable admitted work is a planning conflict, not worker-owned ambiguity/);
});

test("Study 15 deliberately removes the old all-task scrubber and intelligence-dashboard experiments", () => {
  assert.doesNotMatch(study, /chronicleFocusWeight|focusDistanceTier|clockLensViewport|role="slider"/);
  assert.doesNotMatch(study, /Return to now/);
  assert.doesNotMatch(study, /FeedScope|MANAGER FEED|>Mine<|>Team</);
  assert.doesNotMatch(study, /progressiveSignals|signalsForTier|TaskIntelligence|CloseoutMoment|END-OF-DAY PREVIEW/);
  assert.doesNotMatch(study, /UNLOCKS/);
  assert.match(contract, /Clock is not a scrubber by default/);
  assert.match(contract, /Study 15 removes the previous `Mine \| Team` blended Clock experiment/);
});

test("Occupied Time stays a neutral non-task rail object and the nearest hard edge earns readable space", () => {
  assert.match(study, /type OccupiedSpan/);
  assert.match(study, /Supplier delivery window/);
  assert.match(study, /Pickup at Elm/);
  assert.match(study, /function HardEdge/);
  assert.match(study, /NEXT HARD EDGE/);
  assert.match(contract, /occupied_time != task/);
  assert.match(contract, /nearest operationally important hard edge/);
});

test("bounded Clock now fits three state specimens without an internal all-task scroll owner", () => {
  assert.match(smartCss, /\.executionPhone[\s\S]*height: 820px/);
  assert.match(smartCss, /\.executionSurface[\s\S]*overflow: hidden/);
  assert.match(smartCss, /\.executionNeighborhood[\s\S]*overflow: hidden/);
  assert.match(smartCss, /\.executionStudyGrid[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(contract, /Clock no longer needs an internal all-task scroll owner/);
});

test("contract assigns clear jurisdiction to Day Clock Task Focus domain rails and Atlas intelligence", () => {
  assert.match(contract, /Day \/ Work.*owns the complete current service day/);
  assert.match(contract, /Clock.*owns temporal custody/);
  assert.match(contract, /Task Focus.*owns execution detail/);
  assert.match(contract, /Domain rails \/ task-family views.*own downstream meaning/);
  assert.match(contract, /Atlas intelligence.*owns the reasoning/);
});

test("future Manager Clock is person-centered rather than a blended pseudo-day", () => {
  assert.match(contract, /Manager Clock should be person-centered, not a blended Team Clock/);
  assert.match(contract, /Anna \/ Marshall \/ Me/);
  assert.match(contract, /Complete multi-person workload remains a Manager\/Day concern/);
});

test("shared Atlas shell keeps + on Home and gives every other route a governed exit X", () => {
  assert.match(shell, /usePathname, useSearchParams/);
  assert.match(shell, /safeInternalReturnTo/);
  assert.match(shell, /pathname\.startsWith\("\/task"\)/);
  assert.match(shell, /const headerAction = active === "home"/);
  assert.match(shell, /aria-label="Document work"/);
  assert.match(shell, /className="atlas-global-note-plus atlas-global-exit"/);
  assert.match(shell, />×<\/Link>/);
  assert.match(globalHeaderCss, /\.atlas-global-exit/);
});
