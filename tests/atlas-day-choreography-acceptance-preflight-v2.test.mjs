import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proof = readFileSync(
  new URL("../supabase/tests/atlas_day_choreography_acceptance_preflight_v2.sql", import.meta.url),
  "utf8",
);

test("acceptance v2 covers worker task/cue boundaries", () => {
  assert.match(proof, /visibility_scope='system_internal'/);
  assert.match(proof, /grow_room_round_requests/);
  assert.match(proof, /requirement_confirmation_v1/);
  assert.match(proof, /waiting_on_prerequisite|task_prerequisites/);
});

test("acceptance v2 covers event place and dynamic briefing truth", () => {
  assert.match(proof, /elm_first_ticketed_thursday_bloom_bar_2026_08_13/);
  assert.match(proof, /zone\.stable_key='venue'/);
  assert.match(proof, /event_day_briefing_body_v1/);
  assert.match(proof, /Lebanon harvest this morning\. Elm setup afterward\./);
  assert.match(proof, /hardcodes acceptance-case place\/person names/);
});

test("acceptance v2 covers source-model schedule and Owner placement truth", () => {
  assert.match(proof, /planned_work_occurrences/);
  assert.match(proof, /planned_due_date IS DISTINCT FROM task\.due_date/);
  assert.match(proof, /commitment_kind='floating'/);
  assert.match(proof, /sky_deferral_mode='allow'/);
});

test("acceptance v2 resolves the live worker identity instead of hardcoding membership UUIDs", () => {
  assert.match(proof, /worker_key='anna'/);
  assert.doesNotMatch(proof, /23e98e5e-16ca-40d8-872c-c77e06baa167/i);
});
