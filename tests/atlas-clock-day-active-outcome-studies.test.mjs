import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const study = read("app/owner/clock-day-lab/ActiveOutcomeStudies.tsx");
const css = read("app/owner/clock-day-lab/active-outcome-studies.module.css");

test("Clock Day lab exposes rolling scorecard clock plus ordered rail study", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Rolling time deck inside the scorecard/);
  assert.match(study, /Time rolls through the scorecard\. Work stays on the rail\./);
  assert.match(study, /TimeRollerDeck/);
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

test("separate day progress row and separate NOW sliver are removed", () => {
  assert.doesNotMatch(study, /dayProgress/);
  assert.doesNotMatch(study, /NowSliver/);
  assert.doesNotMatch(study, /nowTaskStrip/);
  assert.doesNotMatch(css, /\.dayProgress/);
  assert.doesNotMatch(css, /\.nowSliver/);
  assert.doesNotMatch(css, /\.nowTaskStrip/);
});

test("purple scorecard cap owns both progress and rolling current-time viewport", () => {
  assert.match(study, /TimeRollerDeck/);
  assert.match(study, /dayMeter/);
  assert.match(study, /6 \/ 11/);
  assert.match(study, /rollerViewport/);
  assert.match(study, /data-position="previous"/);
  assert.match(study, /data-position="current"/);
  assert.match(study, /data-position="next"/);
  assert.match(study, /3:24/);
  assert.match(study, /3:42 PM/);
  assert.match(study, /4:00/);
  assert.match(study, /00:18/);
  assert.match(css, /\.timeDeck/);
  assert.match(css, /background: #eeecfb/);
  assert.match(css, /\.rollerViewport/);
  assert.match(css, /overflow: hidden/);
  assert.match(css, /\.rollerSelection/);
  assert.match(css, /rollerRow\[data-position="previous"\]/);
  assert.match(css, /rollerRow\[data-position="current"\]/);
  assert.match(css, /rollerRow\[data-position="next"\]/);
});

test("scorecard stays compact while preserving count, move and distant unlock", () => {
  assert.match(study, /scoreBody/);
  assert.match(study, /<strong>11<\/strong>/);
  assert.match(study, /<span>tasks<\/span>/);
  assert.match(study, /<small>6 done<\/small>/);
  assert.match(study, /POT UP/);
  assert.match(study, /Sweet William/);
  assert.match(study, /UNLOCKS/);
  assert.match(study, /Harvest Stems · May 6/);
  assert.match(css, /\.outcomeBox/);
  assert.match(css, /height: 128px/);
  assert.match(css, /\.scoreBody/);
  assert.match(css, /grid-template-columns: 27% 73%/);
  assert.match(css, /height: 79px/);
});

test("all incomplete tasks remain fully live and ordered on the task rail", () => {
  assert.doesNotMatch(study, /data-passed/);
  assert.doesNotMatch(css, /cleanNode\[data-passed/);
  assert.doesNotMatch(css, /opacity:\s*0\.58/);
  assert.match(css, /\.cleanRail::before/);
  assert.match(css, /\.cleanNode/);
  assert.match(study, /data-active={active \? "true" : "false"}/);
});

test("ordered task rail keeps factual unlocks and consistent task grammar", () => {
  assert.match(study, /Ordered task rail fixture/);
  assert.match(study, /Choose Overwintering Crop · Sep 15/);

  for (const token of [
    "STEWARDSHIP",
    "Farm Round · Elm Farm",
    "WEED",
    "MG11",
    "Main Garden",
    "30 min · Heavy",
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
  assert.doesNotMatch(css, /\.calendarEvent/);
  assert.doesNotMatch(css, /\.focusCard/);
});
