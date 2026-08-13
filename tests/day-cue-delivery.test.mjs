import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const delivery = read("app/day/DayCueDelivery.tsx");
const layout = read("app/day/layout.tsx");
const responseRoute = read("app/api/atlas/day-cue-response/route.ts");
const cueMigration = read("supabase/migrations/20260811162000_atlas_day_cue_mutations_v1.sql");

test("Day cue delivery reaches the worker and the deliberate Owner operator-lens preview", () => {
  assert.match(delivery, /targetSource !== "worker_self" && targetSource !== "operator_lens"/);
  assert.match(delivery, /isOperatorPreview = targetSource === "operator_lens"/);
  assert.match(delivery, /Owner cue preview · testing will not clear this for the worker/);
  assert.match(delivery, /anchorKind === "first_open" \|\| cue\.anchorKind === "at_time"/);
  assert.match(delivery, /recoveryPolicy === "expire"/);
  assert.match(layout, /<DayCueDelivery \/>/);
});

test("a real worker cue is resolved only after its response persists while preview resolution stays local", () => {
  assert.match(delivery, /\/api\/atlas\/day-cue-response/);
  assert.match(delivery, /day-cue-response-v1/);
  assert.match(delivery, /if \(!request\.ok\) throw/);
  assert.match(delivery, /if \(isOperatorPreview\) \{/);
  assert.match(delivery, /setDismissedForSession/);
  assert.match(responseRoute, /worker_resolve_day_cue_api_v1/);
  assert.match(cueMigration, /status='resolved'/);
});

test("observation cues can ask a tiny sequence instead of becoming check tasks", () => {
  assert.match(delivery, /payload\.questions/);
  assert.match(delivery, /currentQuestion/);
  assert.match(delivery, /choices/);
  assert.match(delivery, /input.*number/);
  assert.doesNotMatch(delivery, /overdue/i);
});
