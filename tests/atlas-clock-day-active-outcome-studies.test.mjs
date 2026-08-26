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

test("Clock Day lab exposes the smart single-rail plus compact consequence study", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Smart single rail \+ Atlas-style consequence row/);
  assert.match(study, /One rail carries work progress, time, and where Atlas placed the day\./);
  assert.match(study, /SmartDayRail/);
  assert.match(study, /CurrentMoveRoller/);
  assert.match(study, /ConsequenceStrip/);
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

test("one physical rail carries smart progress, NOW, and task distribution", () => {
  assert.match(study, /SMART_PROGRESS_FRONTIER = 43/);
  assert.match(study, /CURRENT_TIME_POSITION = 69/);
  assert.match(study, /DAY_TASK_POSITIONS = \[6, 13, 21, 29, 38, 47, 55, 64, 72, 84, 94\]/);
  assert.match(study, /smartRailBase/);
  assert.match(study, /smartRailProgress/);
  assert.match(study, /smartRailTaskDot/);
  assert.match(study, /smartRailNowDot/);
  assert.match(study, /smartRailNowLabel/);
  assert.match(study, /6 \/ 11/);
  assert.match(study, /4:06 PM/);
  assert.match(study, /WINDOW/);
  assert.match(study, /00:18/);
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

test("NOW roller remains unboxed and uses a faint center hairline", () => {
  assert.match(study, /CurrentMoveRoller/);
  assert.match(study, /Unboxed rolling current scheduled move fixture/);
  assert.match(study, /data-position="previous"/);
  assert.match(study, /data-position="current"/);
  assert.match(study, /data-position="next"/);
  assert.match(study, /3:30 PM/);
  assert.match(study, /4:06 PM/);
  assert.match(study, /7:00 PM/);
  assert.match(study, /POT UP/);
  assert.match(study, /Sweet William/);
  assert.match(css, /\.timeDeck/);
  assert.match(css, /\.rollerSelection/);
  assert.match(css, /rgba\(118, 110, 190, 0\.32\)/);
});

test("consequence surface uses compact Atlas carried-row grammar instead of a second scorecard", () => {
  assert.match(study, /SLIPPED_OUTCOME_TASK/);
  assert.match(study, /family: "TIDY"/);
  assert.match(study, /title: "Farmhouse"/);
  assert.match(study, /Thursday Ticketed Night · Aug 27/);
  assert.match(study, /MISSED WINDOW/);
  assert.match(study, /still open/);
  assert.match(study, /Holding/);
  assert.match(study, /consequenceStrip/);
  assert.match(study, /consequencePill/);
  assert.match(study, /consequenceCaret/);
  assert.match(smartCss, /\.consequenceStrip/);
  assert.match(smartCss, /grid-template-columns: auto minmax\(0, 1fr\) 18px/);
  assert.match(smartCss, /background: #f7f7fb/);
  assert.doesNotMatch(study, /scoreBody|scoreCount|scoreMove|scoreUnlock/);
});

test("consequence contract requires governed consequence truth and hides empty generic rows", () => {
  assert.match(contract, /real dependency\/unlock edge/);
  assert.match(contract, /hard date or fixed event/);
  assert.match(contract, /Never manufacture consequence importance from display prose/);
  assert.match(contract, /If there is no unresolved task with a governed consequence, the consequence row should be absent/);
  assert.match(contract, /NOW task/);
  assert.match(contract, /Consequence task/);
  assert.match(contract, /must not collapse them into one `activeTask` variable/);
});

test("current move and slipped consequence remain different selectors", () => {
  assert.match(study, /const ACTIVE_TASK = TASKS\[3\]/);
  assert.match(study, /const SLIPPED_OUTCOME_TASK = TASKS\[2\]/);
  assert.match(study, /data-active={active \? "true" : "false"}/);
  assert.match(study, /SLIPPED_OUTCOME_TASK\.family/);
  assert.match(study, /SLIPPED_OUTCOME_TASK\.title/);
});

test("all incomplete tasks remain fully live and ordered on the task rail", () => {
  assert.doesNotMatch(study, /data-passed/);
  assert.doesNotMatch(css, /cleanNode\[data-passed/);
  assert.doesNotMatch(css, /opacity:\s*0\.58/);
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
