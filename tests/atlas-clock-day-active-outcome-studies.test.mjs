import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const study = read("app/owner/clock-day-lab/ActiveOutcomeStudies.tsx");
const css = read("app/owner/clock-day-lab/active-outcome-studies.module.css");

test("Clock Day lab exposes forward clock plus slipped consequence score study", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Forward clock \+ slipped consequence score/);
  assert.match(study, /The clock points forward\. The scorecard remembers what slipped\./);
  assert.match(study, /DayInstrument/);
  assert.match(study, /CurrentMoveRoller/);
  assert.match(study, /OutcomeScorecard/);
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

test("day completion, current time, and active window share one compact instrument under date", () => {
  assert.match(study, /Merged day progress and current window instrument fixture/);
  assert.match(study, /6 \/ 11/);
  assert.match(study, /4:06 PM/);
  assert.match(study, /WINDOW/);
  assert.match(study, /00:18/);
  assert.match(css, /\.dayInstrument/);
  assert.match(css, /grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.dayClockTrack/);
  assert.match(css, /\.dayClockDot/);
  assert.doesNotMatch(study, /dayProgress/);
  assert.doesNotMatch(css, /\.dayProgress/);
});

test("NOW roller is unboxed and uses a faint center hairline", () => {
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
  assert.match(css, /background: transparent/);
  assert.match(css, /\.rollerSelection/);
  assert.match(css, /height: 1px/);
  assert.match(css, /rgba\(118, 110, 190, 0\.32\)/);
  assert.match(css, /rollerRow\[data-position="previous"\]/);
  assert.match(css, /rollerRow\[data-position="current"\]/);
  assert.match(css, /rollerRow\[data-position="next"\]/);
});

test("white scorecard independently carries the most consequential slipped task and real downstream target shape", () => {
  assert.match(study, /SLIPPED_OUTCOME_TASK/);
  assert.match(study, /family: "TIDY"/);
  assert.match(study, /title: "Farmhouse"/);
  assert.match(study, /Thursday Ticketed Night · Aug 27/);
  assert.match(study, /scoreBody/);
  assert.match(study, /scoreUnlock/);
  assert.match(css, /\.outcomeBox/);
  assert.match(css, /\.scoreBody/);
  assert.match(css, /grid-template-columns: 27% 73%/);
  assert.match(css, /border: 1px solid #dedde4/);
  assert.match(css, /border-radius: 20px/);
});

test("current move and slipped consequence are different selectors", () => {
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
