import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const lab = read("app/owner/clock-day-lab/ClockDayLab.tsx");

test("Clock Day lab exists as an owner-only fixture gallery", () => {
  assert.match(page, /ClockDayLab/);
  assert.match(page, /Clock \+ Day Lab · Atlas/);
  assert.match(lab, /data-atlas-clock-day-lab="fixture-only"/);
  assert.match(lab, /data-live-worker-binding="none"/);
  assert.match(lab, /data-task-transition-capability="none"/);
  assert.match(lab, /DESIGN FIXTURES ONLY/);
});

test("Clock Day lab cannot read or mutate the live worker day", () => {
  assert.doesNotMatch(lab, /useAtlasWorkerDayProjection/);
  assert.doesNotMatch(lab, /AtlasRuntimeProvider/);
  assert.doesNotMatch(lab, /fetch\s*\(/);
  assert.doesNotMatch(lab, /\/api\/atlas\//);
  assert.doesNotMatch(lab, /supabase/i);
  assert.doesNotMatch(lab, /postAtlasTaskTransition/);
  assert.doesNotMatch(lab, /taskId\s*[:=]/);
  assert.doesNotMatch(lab, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("Clock Day lab encodes the intended merged worker-day architecture", () => {
  assert.match(lab, /Clock owns the service day/);
  assert.match(lab, /Timeline \+ Day Feed/);
  assert.match(lab, /No duplicate scheduling logic/);
  assert.match(lab, /Work tab disappears/);
  assert.match(lab, /A · One Clock, two lenses/);
  assert.match(lab, /B · Feed first, clock persistent/);
  assert.match(lab, /C · Living daybook/);
});

test("Clock Day lab stress-tests materially different day states", () => {
  for (const label of ["Clocked in", "Before shift", "Overloaded", "Day complete"]) {
    assert.match(lab, new RegExp(label));
  }
  assert.match(lab, /RECOVERY FIRST/);
  assert.match(lab, /Day complete/);
});
