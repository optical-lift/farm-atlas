import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const study = read("app/owner/clock-day-lab/ActiveOutcomeStudies.tsx");
const css = read("app/owner/clock-day-lab/active-outcome-studies.module.css");

test("Clock Day lab exposes the two merged rail-clock studies", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Moving NOW node/);
  assert.match(study, /B · Clock spine/);
  assert.match(study, /The rail is the clock/);
  assert.doesNotMatch(study, /A · Calendar \+ branch rail/);
  assert.doesNotMatch(study, /C · Work window \+ dependency lanes/);
});

test("merged studies remain fixture-only and cannot touch worker state", () => {
  assert.match(study, /data-atlas-active-outcome-studies="fixture-only"/);
  assert.match(study, /data-live-task-binding="none"/);
  assert.match(study, /data-task-transition-capability="none"/);
  assert.doesNotMatch(study, /fetch\s*\(/);
  assert.doesNotMatch(study, /\/api\/atlas\//);
  assert.doesNotMatch(study, /createAtlasServerClient|@supabase\/|useAtlasWorkerDayProjection|postAtlasTaskTransition/i);
  assert.doesNotMatch(study, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("there is one surface rather than Timeline and Daybook modes", () => {
  assert.doesNotMatch(study, /MiniToggle/);
  assert.doesNotMatch(study, />Timeline</);
  assert.doesNotMatch(study, />Daybook</);
  assert.doesNotMatch(css, /\.miniToggle/);
  assert.doesNotMatch(study, /CalendarGrid|RailFeed/);
});

test("day count, factual unlocks, and consistent task grammar remain", () => {
  assert.match(study, /<strong>11<\/strong>/);
  assert.match(study, /<span>tasks<\/span>/);
  assert.match(study, /<small>6 done<\/small>/);
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

test("moving NOW study makes current time a crossing of the task rail", () => {
  assert.match(study, /MovingNowNode/);
  assert.match(study, /nowCrossing/);
  assert.match(study, /3:06 PM/);
  assert.match(css, /\.movingRail::before/);
  assert.match(css, /\.movingNode\[data-active="true"\]/);
  assert.match(css, /\.nowCrossing/);
});

test("clock-spine study uses a sparse time scale with tasks attached as nodes", () => {
  assert.match(study, /ClockSpine/);
  assert.match(study, /HOURS/);
  assert.match(study, /spineTask/);
  assert.match(study, /spineNow/);
  assert.match(css, /\.clockSpine::before/);
  assert.match(css, /\.hourTick/);
  assert.match(css, /\.spineNow/);
});

test("task presentation is rail-based rather than nested calendar cards", () => {
  assert.doesNotMatch(css, /\.calendarEvent/);
  assert.doesNotMatch(css, /\.focusCard/);
  assert.match(css, /\.railDot/);
  assert.match(css, /\.unlockBranch/);
  assert.match(css, /background: #fff/);
  assert.match(css, /#8b83ce|#7469bd|#786fca/);
});
