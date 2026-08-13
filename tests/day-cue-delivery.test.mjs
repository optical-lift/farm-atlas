import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const delivery = read("app/GlobalDayCueDelivery.tsx");
const rootLayout = read("app/layout.tsx");
const dayLayout = read("app/day/layout.tsx");
const taskLayout = read("app/task-focus/[taskId]/layout.tsx");
const responseRoute = read("app/api/atlas/day-cue-response/route.ts");
const dismissRoute = read("app/api/atlas/day-cue-dismiss/route.ts");
const cueMigration = read("supabase/migrations/20260811162000_atlas_day_cue_mutations_v1.sql");
const dismissMigration = read("supabase/migrations/20260813022500_worker_day_cue_dismiss_v1.sql");

test("Day cue delivery reaches the worker and deliberate Owner operator-lens preview from the universal app shell", () => {
  assert.match(delivery, /targetSource !== "worker_self" && targetSource !== "operator_lens"/);
  assert.match(delivery, /isOperatorPreview = targetSource === "operator_lens"/);
  assert.match(delivery, /Owner cue preview · testing will not clear this for the worker/);
  assert.match(delivery, /cue\.anchorKind === "first_open" \|\| cue\.anchorKind === "at_time"/);
  assert.match(delivery, /recoveryPolicy === "expire"/);
  assert.match(rootLayout, /<GlobalDayCueDelivery \/>/);
  assert.doesNotMatch(dayLayout, /DayCueDelivery/);
  assert.doesNotMatch(taskLayout, /TaskFocusCueDelivery/);
});

test("a real worker cue resolves only after response persistence while dismissal stays a distinct persistent state", () => {
  assert.match(delivery, /\/api\/atlas\/day-cue-response/);
  assert.match(delivery, /day-cue-response-v1/);
  assert.match(delivery, /\/api\/atlas\/day-cue-dismiss/);
  assert.match(delivery, /day-cue-dismiss-v1/);
  assert.match(delivery, /if \(!request\.ok\) throw/);
  assert.match(delivery, /if \(isOperatorPreview\) \{/);
  assert.match(delivery, /sessionStorage\.setItem/);
  assert.match(responseRoute, /worker_resolve_day_cue_api_v1/);
  assert.match(dismissRoute, /worker_dismiss_day_cue_api_v1/);
  assert.match(cueMigration, /status='resolved'/);
  assert.match(dismissMigration, /status='dismissed'/);
  assert.doesNotMatch(dismissMigration, /resolved_at=now\(\)/);
});

test("observation cues can ask a tiny sequence instead of becoming check tasks", () => {
  assert.match(delivery, /payload\.questions/);
  assert.match(delivery, /currentQuestion/);
  assert.match(delivery, /choices/);
  assert.match(delivery, /input.*number/);
  assert.doesNotMatch(delivery, /overdue/i);
});
