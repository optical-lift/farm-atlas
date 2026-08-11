import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260811180500_atlas_day_cue_observation_result_contract_v1.sql");
const delivery = read("app/day/DayCueDelivery.tsx");

test("Day cue result contracts are narrow farm-state transitions, not arbitrary cue writes", () => {
  assert.match(migration, /apply_worker_day_cue_result_contract_v1/);
  assert.match(migration, /transplant_readiness_gate_v1/);
  assert.match(migration, /Unsupported Day cue result contract/);
  assert.match(migration, /Only the assigned worker can resolve a farm-state cue/);
  assert.match(migration, /record_task_transition_v1_internal/);
  assert.doesNotMatch(migration, /execute\s+format\(/i);
});

test("Fall kale readiness is delivered as an observation gate instead of worker work", () => {
  assert.match(migration, /crop_profile_stable_key'='fall_kale_seedling/);
  assert.match(migration, /visibility_scope='system_internal'/);
  assert.match(migration, /'worker_feed_task',false/);
  assert.match(migration, /Is the fall kale big enough to pot up\?/);
  assert.match(migration, /What do the kale seedlings look like now\?/);
  assert.match(migration, /Yes, it’s ready/);
  assert.match(migration, /Not yet/);
  assert.match(migration, /Already potted/);
  assert.match(migration, /Something went wrong/);
  assert.match(migration, /All of them — they look great/);
  assert.match(migration, /Struggling but still there/);
  assert.match(migration, /Record number/);
  assert.match(delivery, /payload\.questions/);
});

test("not-ready starts another observation day while ready releases the real next move", () => {
  assert.match(migration, /next_worker_day_v1/);
  assert.match(migration, /farmState','not_ready/);
  assert.match(migration, /readyMoveTitle','Pot up fall kale/);
  assert.match(migration, /source_readiness_task_id/);
  assert.match(migration, /release_reason.*observation_gate_ready/s);
  assert.match(migration, /greatest\(v_cue\.service_date,current_date\)/);
});

test("stale cues recover as fresh reality questions and expired briefings do not become overdue work", () => {
  assert.match(migration, /c\.service_date<p_day/);
  assert.match(migration, /recoveryPolicy/);
  assert.match(migration, /recoveryPrompt/);
  assert.match(migration, /then 'stale'/);
  assert.match(migration, /c\.recovery_policy in \('refresh','persist','block'\)/);
  assert.doesNotMatch(migration, /overdue/i);
});
