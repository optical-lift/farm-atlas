import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const study = read("app/owner/clock-day-lab/ActiveOutcomeStudies.tsx");
const css = read("app/owner/clock-day-lab/active-outcome-studies.module.css");

test("Clock Day lab exposes the countdown scorecard plus clean rail study", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Living countdown \+ clean rail/);
  assert.match(study, /Time lives at the top\. Work lives on the rail\./);
  assert.match(study, /CurrentMoveScorecard/);
  assert.match(study, /CountdownRail/);
});

test("merged study remains fixture-only and cannot touch worker state", () => {
  assert.match(study, /data-atlas-active-outcome-studies="fixture-only"/);
  assert.match(study, /data-live-task-binding="none"/);
  assert.match(study, /data-task-transition-capability="none"/);
  assert.doesNotMatch(study, /fetch\s*\(/);
  assert.doesNotMatch(study, /\/api\/atlas\//);
  assert.doesNotMatch(study, /createAtlasServerClient|@supabase\/|useAtlasWorkerDayProjection|postAtlasTaskTransition/i);
  assert.doesNotMatch(study, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("scorecard carries day progress, current move, unlock, and ambient time", () => {
  assert.match(study, /TODAY/);
  assert.match(study, /11 tasks · 6 done/);
  assert.match(study, /CURRENT MOVE/);
  assert.match(study, /Pot up Sweet William/);
  assert.match(study, /Harvest Stems · May 6/);
  assert.match(study, /WINDOW/);
  assert.match(study, /00:33/);
  assert.match(study, /7 AM/);
  assert.match(study, /3:27 PM/);
  assert.match(study, /8 PM/);
  assert.match(css, /\.scorecard/);
  assert.match(css, /\.timeTrack/);
  assert.match(css, /\.currentTimeDot/);
});

test("task feed no longer repeats a separate schedule column", () => {
  assert.doesNotMatch(study, /nodeWhen/);
  assert.doesNotMatch(study, />Morning</);
  assert.doesNotMatch(study, />Midafternoon</);
  assert.doesNotMatch(study, />Evening</);
  assert.doesNotMatch(css, /\.nodeWhen/);
  assert.match(css, /\.cleanRail::before/);
  assert.match(css, /\.cleanNode/);
});

test("factual unlock branches and consistent task grammar remain", () => {
  assert.match(study, /UNLOCKS/);
  assert.match(study, /Harvest Stems · May 6/);
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
});

test("current task is emphasized by rail state rather than a nested task card", () => {
  assert.match(study, /data-active={active \? "true" : "false"}/);
  assert.match(css, /\.cleanNode\[data-active="true"\]/);
  assert.match(css, /\.railDot/);
  assert.match(css, /\.unlockBranch/);
  assert.doesNotMatch(css, /\.calendarEvent/);
  assert.doesNotMatch(css, /\.focusCard/);
});
