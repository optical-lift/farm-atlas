import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const futureClock = readFileSync(
  new URL("../app/owner/design-atlas/FutureClockFixture.tsx", import.meta.url),
  "utf8",
);
const workshop = readFileSync(
  new URL("../app/owner/design-atlas/DesignWorkshop.tsx", import.meta.url),
  "utf8",
);

test("Design Atlas future Clock is the chosen Clock Study 15 execution neighborhood", () => {
  assert.match(futureClock, /data-atlas-future-clock="clock-study-15"/);
  assert.match(futureClock, /data-clock-day-source="execution-neighborhood"/);
  assert.match(futureClock, /clock-day-lab\/smart-day-study\.module\.css/);
  for (const role of ["last", "now", "next", "then"]) {
    assert.match(futureClock, new RegExp(`role: "${role}"`));
  }
  assert.match(futureClock, /NEXT HARD EDGE/);
  assert.match(futureClock, /Day owns everything else/);
  assert.match(futureClock, /data-live-data-binding="none"/);
  assert.match(futureClock, /data-mutation-capability="none"/);
});

test("Design Atlas Clock + Day workshop leads with Study 15 before production and editor archaeology", () => {
  assert.match(workshop, /label: "Clock \+ Day"/);
  assert.match(workshop, /CHOSEN CLOCK \+ DAY · STUDY 15/);
  assert.match(workshop, /CURRENT PRODUCTION CLOCK/);
  assert.match(workshop, /EDITOR STRESS TESTS/);
  assert.match(workshop, /<ActiveOutcomeStudies \/>/);
  assert.match(workshop, /<UnlockMoveStudies \/>/);
  assert.match(workshop, /<ClockDayLab \/>/);

  const future = workshop.indexOf("<FutureClockFixture />");
  const current = workshop.indexOf("CURRENT PRODUCTION CLOCK");
  const archaeology = workshop.indexOf("EDITOR STRESS TESTS");
  assert.ok(future >= 0, "chosen future Clock specimen must be present");
  assert.ok(current > future, "current production Clock must follow the chosen future specimen");
  assert.ok(archaeology > current, "earlier editor studies must remain after the current production reference");
});
