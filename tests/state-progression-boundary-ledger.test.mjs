import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migrationPath = 'supabase/migrations/20260824222752_state_progression_boundary_ledger_v1.sql';
const contractPath = 'docs/architecture/atlas-state-progression-contract-v1.md';

const migration = () => read(migrationPath);

test('exact production boundary-ledger migration is retained by version', () => {
  assert.equal(fs.existsSync(path.join(root, migrationPath)), true);
  assert.ok(fs.statSync(path.join(root, migrationPath)).size > 0);
});

test('boundary ledger is generic, append-only, and limited to close or reopen truth', () => {
  const sql = migration();
  assert.match(sql, /create table atlas\.requirement_boundary_events/i);
  for (const field of ['subject_kind','subject_id','requirement_set_key','boundary_key','boundary_kind','from_state','to_state','from_evaluation','to_evaluation','evaluated_at','source_kind','source_id','metadata','recorded_at']) {
    assert.match(sql, new RegExp(`\\b${field}\\b`));
  }
  assert.match(sql, /boundary_kind in \('closed','reopened'\)/i);
  assert.match(sql, /from_state in \('open','satisfied'\)/i);
  assert.match(sql, /to_state in \('open','satisfied'\)/i);
  assert.match(sql, /boundary_kind='closed' and from_state='open' and to_state='satisfied'/i);
  assert.match(sql, /boundary_kind='reopened' and from_state='satisfied' and to_state='open'/i);
  assert.match(sql, /before update or delete on atlas\.requirement_boundary_events/i);
  assert.match(sql, /Requirement boundary history is append-only/i);
});

test('boundary recorder requires canonical before and after evaluation snapshots', () => {
  const sql = migration();
  assert.match(sql, /jsonb_typeof\(p_from_evaluation\) <> 'object'/i);
  assert.match(sql, /jsonb_typeof\(p_to_evaluation\) <> 'object'/i);
  assert.match(sql, /jsonb_typeof\(p_from_evaluation->'satisfied'\) <> 'boolean'/i);
  assert.match(sql, /jsonb_typeof\(p_to_evaluation->'satisfied'\) <> 'boolean'/i);
  assert.match(sql, /v_from_satisfied <> \(v_from_state='satisfied'\)/i);
  assert.match(sql, /v_to_satisfied <> \(v_to_state='satisfied'\)/i);
  assert.match(sql, /if v_from_state = v_to_state then\s+return null;/i);
});

test('boundary identity is idempotent and conflicting truth fails closed', () => {
  const sql = migration();
  assert.match(sql, /unique \(subject_kind, subject_id, requirement_set_key, boundary_key\)/i);
  assert.match(sql, /on conflict \(subject_kind, subject_id, requirement_set_key, boundary_key\) do nothing/i);
  assert.match(sql, /Boundary key already exists with different truth/i);
  assert.match(sql, /errcode='23505'/i);
  assert.match(sql, /return v_existing\.id/i);
});

test('boundary writes are service-internal and direct mutation is closed', () => {
  const sql = migration();
  assert.match(sql, /alter table atlas\.requirement_boundary_events enable row level security/i);
  assert.match(sql, /revoke all on atlas\.requirement_boundary_events from public, anon, authenticated/i);
  assert.match(sql, /revoke insert, update, delete on atlas\.requirement_boundary_events from service_role/i);
  assert.match(sql, /grant select on atlas\.requirement_boundary_events to service_role/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path to 'pg_catalog','atlas'/i);
  assert.match(sql, /revoke all on function atlas\.record_requirement_boundary_v1\([\s\S]*?\) from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function atlas\.record_requirement_boundary_v1\([\s\S]*?\) to service_role/i);
});

test('boundary step introduces no effect consumer or domain-specific coupling', () => {
  const sql = migration();
  assert.doesNotMatch(sql, /after\s+insert\s+on\s+atlas\.requirement_boundary_events/i);
  assert.doesNotMatch(sql, /task_execution_readiness_v1|worker_day|farm_round|release_eligible_work|dependency_clock|notification|principal_clock|crop_|seed_/i);
  assert.doesNotMatch(sql, /update\s+atlas\.tasks|insert\s+into\s+atlas\.tasks/i);
});

test('governing contract makes Boundary explicit while keeping Effect outside this step', () => {
  const contract = read(contractPath);
  assert.match(contract, /Second implementation boundary: append-only requirement boundary ledger/i);
  assert.match(contract, /open → satisfied/);
  assert.match(contract, /satisfied → open/);
  assert.match(contract, /same-state/i);
  assert.match(contract, /idempotent/i);
  assert.match(contract, /no release/i);
  assert.match(contract, /no notification/i);
  assert.match(contract, /no Clock/i);
  assert.match(contract, /task_execution_readiness_v1/);
});
