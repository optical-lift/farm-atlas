import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const study = read("app/owner/clock-day-lab/ActiveOutcomeStudies.tsx");
const css = read("app/owner/clock-day-lab/active-outcome-studies.module.css");

test("Clock Day lab exposes scorecard, NOW sliver, and ordered rail study", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Scorecard \+ NOW sliver \+ ordered rail/);
  assert.match(study, /The outcome is the score\. The clock is an instrument\./);
  assert.match(study, /OutcomeScorecard/);
  assert.match(study, /NowSliver/);
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

test("outcome box preserves the compact prior scorecard grammar", () => {
  assert.match(study, /scoreCount/);
  assert.match(study, /<strong>11<\/strong>/);
  assert.match(study, /<span>tasks<\/span>/);
  assert.match(study, /<small>6 done<\/small>/);
  assert.match(study, /scoreMove/);
  assert.match(study, /POT UP/);
  assert.match(study, /Sweet William/);
  assert.match(study, /UNLOCKS/);
  assert.match(study, /Harvest Stems · May 6/);
  assert.match(css, /\.outcomeBox/);
  assert.match(css, /grid-template-columns: 27% 73%/);
  assert.match(css, /\.scoreCount/);
  assert.match(css, /border-right: 1px solid #e3e2e8/);
});

test("clock is a compact sliver below the outcome box", () => {
  assert.match(study, /Compact current-time instrument fixture/);
  assert.match(study, /WINDOW/);
  assert.match(study, /00:18/);
  assert.match(study, /3:42 PM/);
  assert.match(study, /7 AM/);
  assert.match(study, /8 PM/);
  assert.match(study, /nowTaskStrip/);
  assert.match(study, /<span>NOW<\/span>/);
  assert.match(css, /\.nowSliver/);
  assert.match(css, /\.instrumentRow/);
  assert.match(css, /min-height: 48px/);
  assert.match(css, /\.nowTaskStrip/);
  assert.match(css, /\.timeTrack/);
  assert.match(css, /\.currentTimeDot/);
});

test("all incomplete tasks remain fully live instead of fading after time passes", () => {
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
