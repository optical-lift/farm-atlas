import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20260731201200_atlas_narrow_read_helpers_v1.sql',
  import.meta.url,
);
const sql = readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim();

const reviewedHelpers = [
  'atlas.bell_event_obligation_key_v2(uuid)',
  'atlas.bell_event_why_v2(uuid, uuid)',
  'atlas.goal_unlocked_today_v1(uuid, date)',
  'atlas.object_crop_occupancy_v1(uuid)',
  'atlas.resolve_goal_state_v1(uuid, date)',
];

const expectedCallers = [
  'bell_badge_count_for_user_v1(p_farm_id uuid, p_user_id uuid)',
  'bell_history_v2(p_farm_id uuid, p_effective_membership_id uuid, p_limit integer, p_before timestamp with time zone)',
  'living_day_v1(p_farm_id uuid, p_day date)',
  'weed_card_task_focus_v1(p_task_id uuid)',
  'evaluate_goal_unlocks_v1(p_farm_id uuid, p_as_of_date date, p_release boolean)',
  'farm_goal_list_v1(p_farm_id uuid, p_as_of_date date)',
];

test('migration revokes exactly the five reviewed read helpers from authenticated', () => {
  for (const signature of reviewedHelpers) {
    assert.match(
      normalized,
      new RegExp(
        `REVOKE EXECUTE ON FUNCTION ${signature.replace(/[().]/g, '\\$&').replace(/, /g, ',\\s*')} FROM authenticated`,
        'i',
      ),
    );
  }

  assert.equal(
    (normalized.match(/REVOKE EXECUTE ON FUNCTION/gi) ?? []).length,
    reviewedHelpers.length,
  );
});

test('migration freezes the reviewed SECURITY DEFINER caller graph', () => {
  for (const caller of expectedCallers) {
    assert.ok(sql.includes(caller), `missing expected caller gate for ${caller}`);
  }

  assert.match(normalized, /actual_callers IS DISTINCT FROM expected\.expected_callers/i);
  assert.match(normalized, /NOT caller\.prosecdef/i);
  assert.match(normalized, /caller set drifted/i);
  assert.match(normalized, /non-SECURITY-DEFINER caller/i);
});

test('migration fails closed on function and RLS dependency drift', () => {
  assert.match(normalized, /to_regprocedure\(expected\.signature\)/i);
  assert.match(normalized, /is no longer SECURITY DEFINER/i);
  assert.match(normalized, /policy_reference_count <> 0/i);
  assert.match(normalized, /is referenced by % RLS policies/i);
  assert.match(normalized, /anon unexpectedly has EXECUTE/i);
});

test('service execution is preserved while signed-in execution is verified absent', () => {
  assert.match(normalized, /NOT has_function_privilege\('service_role', helper_oid, 'EXECUTE'\)/i);
  assert.match(normalized, /has_function_privilege\('authenticated', helper_oid, 'EXECUTE'\)/i);
  assert.match(normalized, /service_role lost EXECUTE/i);
  assert.match(normalized, /authenticated still has EXECUTE/i);
});

test('boundary-only migration does not redefine functions or add grants', () => {
  assert.doesNotMatch(normalized, /CREATE OR REPLACE FUNCTION/i);
  assert.doesNotMatch(normalized, /ALTER FUNCTION/i);
  assert.doesNotMatch(normalized, /GRANT EXECUTE/i);
  assert.doesNotMatch(
    sql,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
});
