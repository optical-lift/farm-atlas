import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/clock-day-lab/page.tsx");
const studies = read("app/owner/clock-day-lab/UnlockMoveStudies.tsx");

test("Clock Day editor exposes three single-upcoming-move studies", () => {
  assert.match(page, /UnlockMoveStudies/);
  assert.match(studies, /A · Move → bloom/);
  assert.match(studies, /B · Window first/);
  assert.match(studies, /C · One-line relay/);
  assert.match(studies, /Pot up Sweet William/);
  assert.match(studies, /April blooms/);
  assert.match(studies, /MIDAFTERNOON/);
});

test("unlock studies keep premium space focused on one upcoming move rather than backlog", () => {
  assert.match(studies, /One upcoming move\. One distant payoff\./);
  assert.match(studies, /never repeats the backlog/);
  assert.match(studies, /NEXT MOVE · MIDAFTERNOON/);
  assert.match(studies, /THE MOVE THAT MATTERS NEXT/);
});

test("unlock studies remain fixture-only and cannot bind to live task state", () => {
  assert.match(studies, /data-atlas-unlock-move-studies="fixture-only"/);
  assert.match(studies, /data-live-task-binding="none"/);
  assert.doesNotMatch(studies, /useAtlasWorkerDayProjection/);
  assert.doesNotMatch(studies, /fetch\s*\(/);
  assert.doesNotMatch(studies, /\/api\/atlas\//);
  assert.doesNotMatch(studies, /createAtlasServerClient|@supabase\/|\.schema\(["']atlas["']\)/i);
  assert.doesNotMatch(studies, /postAtlasTaskTransition/);
  assert.doesNotMatch(studies, /taskId\s*[:=]/);
});
