import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const study = read("app/owner/clock-day-lab/ActiveOutcomeStudies.tsx");
const css = read("app/owner/clock-day-lab/active-outcome-studies.module.css");

test("Clock Day lab exposes three paired Timeline and Daybook studies", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Calendar \+ branch rail/);
  assert.match(study, /B · Quiet schedule \+ alternating map/);
  assert.match(study, /C · Work window \+ dependency lanes/);
  assert.match(study, /CLOCK VIEW/);
  assert.match(study, /DAYBOOK VIEW/);
  assert.match(study, /data-view={view}/);
});

test("active outcome studies remain fixture-only and cannot touch worker state", () => {
  assert.match(study, /data-atlas-active-outcome-studies="fixture-only"/);
  assert.match(study, /data-live-task-binding="none"/);
  assert.match(study, /data-task-transition-capability="none"/);
  assert.doesNotMatch(study, /fetch\s*\(/);
  assert.doesNotMatch(study, /\/api\/atlas\//);
  assert.doesNotMatch(study, /createAtlasServerClient|@supabase\/|useAtlasWorkerDayProjection|postAtlasTaskTransition/i);
  assert.doesNotMatch(study, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("tiny view toggle replaces the old full-width mode switch", () => {
  assert.match(study, /MiniToggle/);
  assert.match(study, />Timeline</);
  assert.match(study, />Daybook</);
  assert.match(css, /\.miniToggle/);
  assert.doesNotMatch(study, /modeSwitch/);
  assert.doesNotMatch(css, /\.modeSwitch/);
});

test("active focus uses day-count corner and factual unlock target", () => {
  assert.match(study, /<strong>11<\/strong>/);
  assert.match(study, /<span>tasks<\/span>/);
  assert.match(study, /<small>6 done<\/small>/);
  assert.match(study, /UNLOCKS/);
  assert.match(study, /Harvest Stems · May 6/);
  assert.doesNotMatch(study, /next useful window/i);
  assert.doesNotMatch(study, /stay on track/i);
  assert.doesNotMatch(study, /Exact first-cut date not modeled/);
});

test("overdue area stays compact instead of restating the whole backlog", () => {
  assert.match(study, /OVERDUE · 2/);
  assert.match(study, /showing the one that matters now/);
  assert.match(study, /\+1 hidden/);
});

test("standardized task data survives in both calendar and causal feed", () => {
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
    "Choose Overwintering Crop · Sep 15",
  ]) assert.match(study, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(study, /TaskMeta/);
  assert.match(study, /task\.place} · {task\.amount/);
});

test("Clock is calendar-shaped and Daybook restores a line-and-dot dependency rail", () => {
  assert.match(study, /CalendarGrid/);
  assert.match(study, /RailFeed/);
  assert.match(css, /\.calendarBody/);
  assert.match(css, /\.hourRule/);
  assert.match(css, /\.nowRule/);
  assert.match(css, /\.railBody::before/);
  assert.match(css, /\.nodeDot/);
  assert.match(css, /\.nodeUnlock/);
});

test("purple remains an accent on a predominantly white neutral surface", () => {
  assert.match(css, /background: #fff/);
  assert.match(css, /#8b83ce|#7f74c7|#7469bd/);
  assert.match(css, /#dfdee2|#ecebef|#efeff1/);
});
