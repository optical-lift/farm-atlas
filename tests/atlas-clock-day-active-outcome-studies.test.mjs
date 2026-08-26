import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const study = read("app/owner/clock-day-lab/ActiveOutcomeStudies.tsx");
const css = read("app/owner/clock-day-lab/active-outcome-studies.module.css");

test("Clock Day lab exposes three active-task outcome studies", () => {
  assert.match(page, /ActiveOutcomeStudies/);
  assert.match(study, /A · Clock → harvest/);
  assert.match(study, /B · Active card \+ target strip/);
  assert.match(study, /C · Day ledger/);
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

test("study uses real-shaped Atlas task data with one consistent row grammar", () => {
  for (const token of [
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

  assert.match(study, /taskWhen/);
  assert.match(study, /taskIdentity/);
  assert.match(study, /task\.place} · {task\.amount/);
});

test("premium area points to a task-shaped harvest consequence instead of motivational prose", () => {
  assert.match(study, /HARVEST/);
  assert.match(study, /Harvest Stems/);
  assert.match(study, /Apr 2027/);
  assert.match(study, /Exact first-cut date not modeled/);
  assert.doesNotMatch(study, /next useful window/i);
  assert.doesNotMatch(study, /stay on track/i);
});

test("new studies use purple as an accent and do not introduce a timeline rail", () => {
  assert.doesNotMatch(study, /timelineRail/);
  assert.doesNotMatch(css, /\.timelineRail/);
  assert.match(css, /background: #fff/);
  assert.match(css, /#8d84d6|#9a92d9/);
});
