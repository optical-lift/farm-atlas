import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const effectMigrationPath = 'supabase/migrations/20260825003455_state_progression_pot_up_effect_boundary_v1.sql';
const custodyRepairPath = 'supabase/migrations/20260825003933_state_progression_pot_up_effect_rpc_custody_repair_v1.sql';
const bypassSealPath = 'supabase/migrations/20260825011137_state_progression_pot_up_release_bypass_seal_v1.sql';

const effectMigration = () => read(effectMigrationPath);
const bypassSeal = () => read(bypassSealPath);

test('Step 3 retains the exact production migrations as source', () => {
  for (const relative of [effectMigrationPath, custodyRepairPath, bypassSealPath]) {
    assert.equal(fs.existsSync(path.join(root, relative)), true, `missing production migration source: ${relative}`);
    assert.ok(fs.statSync(path.join(root, relative)).size > 0, `empty production migration source: ${relative}`);
  }
});

test('pot-up completion must evaluate and record a Boundary before applying its release consequence', () => {
  const sql = effectMigration();
  const triggerStart = sql.indexOf('create or replace function atlas.advance_pot_up_serial_queue_v1()');
  const triggerSql = sql.slice(triggerStart);
  const evaluateAt = triggerSql.indexOf('atlas.requirement_set_evaluate_v1');
  const boundaryAt = triggerSql.indexOf('atlas.record_requirement_boundary_v1');
  const effectAt = triggerSql.indexOf('atlas.apply_pot_up_serial_release_effect_v1');
  assert.ok(triggerStart >= 0);
  assert.ok(evaluateAt >= 0 && boundaryAt > evaluateAt && effectAt > boundaryAt, 'evaluation must precede Boundary recording and Boundary must precede Effect');
  assert.match(triggerSql, /'pot_up_serial_predecessor_completion_v1'/);
  assert.match(triggerSql, /'predecessor_task_completed'/);
  assert.match(triggerSql, /'provider','atlas\.tasks\.status'/);
  assert.doesNotMatch(triggerSql, /release_next_task_in_queue_v1/);
});

test('the bounded effect requires the exact closed Boundary and reuses existing queue release machinery', () => {
  const sql = effectMigration();
  const effectStart = sql.indexOf('create or replace function atlas.apply_pot_up_serial_release_effect_v1');
  const triggerStart = sql.indexOf('create or replace function atlas.advance_pot_up_serial_queue_v1()');
  const effectSql = sql.slice(effectStart, triggerStart);
  assert.match(effectSql, /p_boundary_event_id uuid/);
  assert.match(effectSql, /requirement_boundary_events/);
  assert.match(effectSql, /subject_kind<>'task_release_queue_item'/);
  assert.match(effectSql, /requirement_set_key<>'pot_up_serial_predecessor_completion_v1'/);
  assert.match(effectSql, /boundary_kind<>'closed'/);
  assert.match(effectSql, /from_state<>'open'/);
  assert.match(effectSql, /to_state<>'satisfied'/);
  assert.match(effectSql, /source_kind<>'task'/);
  assert.match(effectSql, /v_task\.status<>'done'/);
  assert.match(effectSql, /atlas\.release_next_task_in_queue_v1/);
  assert.match(effectSql, /'state','already_applied'/);
});

test('every pot-up successor surface retains its authorizing Boundary id', () => {
  const sql = effectMigration();
  assert.match(sql, /'completion_boundary_event_id',v_boundary\.id/);
  assert.match(sql, /'release_boundary_event_id',v_boundary\.id/g);
  assert.match(sql, /'release_requirement_set_key',v_boundary\.requirement_set_key/g);
  assert.match(sql, /'release_authorized_from_queue_item_id',v_item\.id/g);
  assert.match(sql, /task_payload=jsonb_set/);
  assert.match(sql, /where id=v_released_task_id/);
});

test('the lower-level queue helper independently refuses pot-up release without the exact Boundary chain', () => {
  const sql = bypassSeal();
  assert.match(sql, /create or replace function atlas\.release_next_task_in_queue_v1/);
  assert.match(sql, /release_boundary_event_id/);
  assert.match(sql, /release_authorized_from_queue_item_id/);
  assert.match(sql, /release_requirement_set_key/);
  assert.match(sql, /pot_up_serial_predecessor_completion_v1/);
  assert.match(sql, /immediately preceding completed queue item/i);
  assert.match(sql, /requirement_boundary_events/);
  assert.match(sql, /subject_kind<>'task_release_queue_item'/);
  assert.match(sql, /boundary_kind<>'closed'/);
  assert.match(sql, /from_state<>'open'/);
  assert.match(sql, /to_state<>'satisfied'/);
  assert.match(sql, /source_kind<>'task'/);
  assert.match(sql, /boundary_authorized_process_continuation_v1/g);
  assert.doesNotMatch(sql, /direct_process_continuation_materialization_v1/);
});

test('the dormant generic direct-release trigger function is retired rather than left as a competing authority', () => {
  const sql = bypassSeal();
  assert.match(sql, /drop function atlas\.advance_task_release_queue_v1\(\);/i);
  assert.doesNotMatch(sql, /create or replace function atlas\.advance_task_release_queue_v1/);
});

test('Step 3 does not turn the Boundary ledger into an insert-triggered effect switchboard', () => {
  const sql = effectMigration();
  assert.doesNotMatch(sql, /create\s+trigger[\s\S]*requirement_boundary_events/i);
  assert.doesNotMatch(sql, /after\s+insert/i);
  assert.match(sql, /revoke execute on function atlas\.apply_pot_up_serial_release_effect_v1\(uuid,date\) from public, anon, authenticated, service_role/i);
});

test('custody repair preserves the pre-existing trigger privilege without exposing the new effect consumer', () => {
  const repair = read(custodyRepairPath);
  const sql = effectMigration();
  assert.match(repair, /^grant execute on function atlas\.advance_pot_up_serial_queue_v1\(\) to service_role;$/i);
  assert.match(sql, /revoke execute on function atlas\.apply_pot_up_serial_release_effect_v1\(uuid,date\) from public, anon, authenticated, service_role/i);
});

test('governing contract records exactly one bounded Effect cutover and leaves broader systems untouched', () => {
  const contract = read('docs/architecture/atlas-state-progression-contract-v1.md');
  assert.match(contract, /Third implementation boundary: one boundary-authorized release effect/i);
  assert.match(contract, /does not create a generic effects engine/i);
  assert.match(contract, /does not add an `AFTER INSERT` consumer to the generic boundary ledger/i);
  assert.match(contract, /does not alter Worker Day, Farm Round, Principal, Clock, notification, or UI behavior/i);
  assert.match(contract, /lower-level release helper also fails closed for `pot_up_serial` unless the authorizing Boundary chain is present/i);
  assert.match(contract, /dormant generic direct-release trigger function is retired/i);
  assert.match(contract, /Only after this single effect path is proven should Atlas select another competing ready\/gate\/release mechanism for retirement/i);
});
