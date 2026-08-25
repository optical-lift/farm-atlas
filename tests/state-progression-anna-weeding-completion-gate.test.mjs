import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL(
  '../supabase/migrations/20260825134000_state_progression_anna_weeding_completion_gate_effect_v1.sql',
  import.meta.url,
);

const sql = await readFile(migrationPath, 'utf8');

function sectionBetween(start, end) {
  const startIndex = sql.indexOf(start);
  const endIndex = sql.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return sql.slice(startIndex, endIndex);
}

test('Anna weeding completion gate crosses State Progression Boundary before Effect', () => {
  const trigger = sectionBetween(
    'create or replace function atlas.advance_anna_weeding_serial_queue_v1()',
    'revoke execute on function atlas.advance_anna_weeding_serial_queue_v1()',
  );

  assert.match(trigger, /weed_serial_gate/);
  assert.match(trigger, /worker_key is distinct from 'anna'/);
  assert.match(trigger, /requirement_set_evaluate_v1/);
  assert.match(trigger, /record_requirement_boundary_v1/);
  assert.match(trigger, /anna_weeding_predecessor_completion_v1/);
  assert.match(trigger, /apply_anna_weeding_serial_release_effect_v1/);
  assert.doesNotMatch(trigger, /release_next_task_in_queue_v1/);
});

test('bounded Anna weeding Effect requires exact closed predecessor Boundary', () => {
  const effect = sectionBetween(
    'create or replace function atlas.apply_anna_weeding_serial_release_effect_v1(',
    'revoke execute on function atlas.apply_anna_weeding_serial_release_effect_v1(uuid,date)',
  );

  assert.match(effect, /subject_kind<>'task_release_queue_item'/);
  assert.match(effect, /requirement_set_key<>'anna_weeding_predecessor_completion_v1'/);
  assert.match(effect, /boundary_kind<>'closed'/);
  assert.match(effect, /from_state<>'open'/);
  assert.match(effect, /to_state<>'satisfied'/);
  assert.match(effect, /source_kind<>'task'/);
  assert.match(effect, /queue_key<>'anna_weeding_rotation'/);
  assert.match(effect, /v_task\.status<>'done'/);
  assert.match(effect, /completion_boundary_event_id/);
  assert.match(effect, /release_boundary_event_id/);
});

test('shared release helper fails closed for Anna weeding without Boundary provenance', () => {
  const helper = sectionBetween(
    'create or replace function atlas.release_next_task_in_queue_v1(',
    'revoke execute on function atlas.release_next_task_in_queue_v1(uuid,text,date)',
  );

  assert.match(helper, /v_is_anna_weeding:=p_queue_key='anna_weeding_rotation'/);
  assert.match(helper, /anna_weeding_predecessor_completion_v1/);
  assert.match(helper, /Completion-gated release requires an authorizing State Progression boundary/);
  assert.match(helper, /release_authorized_from_queue_item_id/);
  assert.match(helper, /completion_boundary_event_id/);
  assert.match(helper, /boundary_authorized_completion_gated_release_v1/);
});

test('Anna cutover remains bounded and does not create generic Boundary routing', () => {
  assert.match(
    sql,
    /revoke execute on function atlas\.apply_anna_weeding_serial_release_effect_v1\(uuid,date\) from public, anon, authenticated, service_role;/,
  );
  assert.match(
    sql,
    /revoke execute on function atlas\.advance_anna_weeding_serial_queue_v1\(\) from public, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(sql, /create\s+trigger[\s\S]*requirement_boundary_events/i);
  assert.doesNotMatch(sql, /after\s+insert[\s\S]*requirement_boundary_events/i);
});
