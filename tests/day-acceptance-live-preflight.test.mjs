import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preflight = readFileSync(
  new URL("../supabase/tests/atlas_day_choreography_acceptance_preflight_v1.sql", import.meta.url),
  "utf8",
);
const normalized = preflight.replace(/\s+/g, " ").trim();

test("Day acceptance preflight follows reconciled Fall kale reality", () => {
  assert.match(preflight, /task\.status='done'/);
  assert.match(preflight, /task\.visibility_scope='system_internal'/);
  assert.match(preflight, /transplant_readiness_status'='already_potted'/);
  assert.match(preflight, /link\.role='observes'/);
  assert.match(preflight, /canonical_state_reconciliation/);
  assert.match(preflight, /cue\.response->>'readiness'='already_potted'/);
  assert.doesNotMatch(normalized, /task_type='transplant_readiness' and metadata->>'crop_profile_stable_key'='fall_kale_seedling' and status in \('open','blocked'\)/i);
});

test("Day acceptance preflight accepts completed Lebanon preparation while protecting Thursday departure truth", () => {
  assert.match(preflight, /status IN \('open','blocked','done'\)/);
  assert.match(preflight, /resource\.label='Saw'/);
  assert.match(preflight, /resource\.label='Air compressor'/);
  assert.match(preflight, /resource\.label='Metal rake with wood handle'/);
  assert.match(preflight, /resource\.label='Black florist buckets' AND requirement\.quantity_needed=5/);
  assert.match(preflight, /resource\.label='Black florist buckets'\s+AND requirement\.quantity_needed=7/);
  assert.match(preflight, /cue\.recovery_policy='block'/);
  assert.match(preflight, /requirement_confirmation_v1/);
});

test("Day acceptance preflight proves Snow requirement branches and the dynamic Bloom Bar briefing", () => {
  assert.match(preflight, /pot_up_tray_200_cell/);
  assert.match(preflight, /requirement\.quantity_needed=3/);
  assert.match(preflight, /pot_up_tray_120_cell/);
  assert.match(preflight, /potting_mix/);
  assert.match(preflight, /pool\.capacity_kind='lit_tray_positions'/);
  assert.match(preflight, /requirement\.quantity_needed=4/);
  assert.match(preflight, /cue\.cue_kind='briefing'/);
  assert.match(preflight, /cue\.anchor_kind='first_open'/);
  assert.match(preflight, /event_day_briefing_body_v1/);
});
