import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migrationPath = 'supabase/migrations/20260824211537_state_progression_requirement_membrane_v1.sql';
const contractPath = 'docs/architecture/atlas-state-progression-contract-v1.md';
const sql = read(migrationPath);
const contract = read(contractPath);

const functionBody = (name) => {
  const start = sql.indexOf(`create or replace function atlas.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = sql.indexOf('\ncreate or replace function atlas.', start + 1);
  return sql.slice(start, next === -1 ? sql.length : next);
};

test('State Progression contract establishes one state-change grammar without flattening domain truth', () => {
  assert.match(contract, /Evidence → Requirement → Evaluation → Boundary → Effect/);
  assert.match(contract, /Progression does not own domain truth/);
  assert.match(contract, /Requirements may reopen/);
  assert.match(contract, /Aggregate readiness is derived/);
  assert.match(contract, /Effects are separate from evaluation/);
  assert.match(contract, /Clock arbitration occurs only after eligibility\/readiness is established/);
  assert.match(contract, /Projects organize work; Progressions establish changed reality/);
});

test('generic requirement evaluator is domain-agnostic, explicit, read-only, and fail-closed', () => {
  const body = functionBody('requirement_set_evaluate_v1');
  assert.match(body, /Requirement set must be a JSON array/);
  assert.match(body, /must contain at least one requirement node/);
  assert.match(body, /requires requirementKey/);
  assert.match(body, /requires boolean satisfied/);
  assert.match(body, /'aggregation','all_required'/);
  assert.match(body, /'evidenceRemainsDomainOwned',true/);
  assert.match(body, /'evaluationDoesNotCreateBoundaryEvent',true/);
  assert.match(body, /'evaluationDoesNotExecuteEffects',true/);
  for (const forbidden of [/task_execution/i, /elm_/i, /crop/i, /seed/i, /farm/i, /resource/i]) {
    assert.doesNotMatch(body, forbidden);
  }
  assert.doesNotMatch(body, /\binsert\b|\bupdate\b|\bdelete\b/i);
});

test('task adapter normalizes exactly the five existing readiness providers', () => {
  const body = functionBody('task_execution_requirement_inputs_v1');
  const providers = [
    'task_prerequisites_ready_v1',
    'task_required_resources_available_v1',
    'task_execution_destination_readiness_v1',
    'task_seed_readiness_v1',
    'task_state_consequence_gate_v1',
  ];
  for (const provider of providers) assert.match(body, new RegExp(provider));
  assert.equal((body.match(/'provider',/g) ?? []).length, 5);
  assert.equal((body.match(/'requirementKey',/g) ?? []).length, 5);
  assert.doesNotMatch(body, /\binsert\b|\bupdate\b|\bdelete\b/i);
});

test('compatibility membrane preserves legacy readiness authority and exposes parity without cutover', () => {
  const body = functionBody('task_execution_requirement_evaluation_v1');
  assert.match(body, /task_execution_requirement_inputs_v1/);
  assert.match(body, /requirement_set_evaluate_v1/);
  assert.match(body, /task_execution_readiness_v1/);
  assert.match(body, /'parity',\(v_satisfied=v_legacy_ready\)/);
  assert.match(body, /'legacyReadinessRemainsExecutionAuthority',true/);
  assert.match(body, /'doesNotMutateTask',true/);
  assert.match(body, /'doesNotReleaseWork',true/);
  assert.match(body, /'doesNotWriteBoundaryLedger',true/);
  assert.match(body, /'doesNotNotify',true/);
  assert.match(body, /'doesNotArbitrateClock',true/);
  assert.doesNotMatch(body, /\binsert\b|\bupdate\b|\bdelete\b/i);
});

test('first membrane creates no stateful mechanism and remains service-internal', () => {
  assert.doesNotMatch(sql, /create\s+(table|trigger|policy)\b/i);
  for (const signature of [
    'atlas.requirement_set_evaluate_v1(jsonb)',
    'atlas.task_execution_requirement_inputs_v1(uuid)',
    'atlas.task_execution_requirement_evaluation_v1(uuid)',
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(sql, new RegExp(`revoke all on function ${escaped} from public,anon,authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function ${escaped} to service_role`, 'i'));
  }
  assert.match(contract, /does not replace `atlas\.task_execution_readiness_v1\(uuid\)`/i);
  assert.match(contract, /Step 1 compatibility membrane remains read-only and does not automatically write boundary events/i);
  assert.match(contract, /no production behavior has been cut over to the new membrane/i);
});

test('exact post-cutover production migration is retained under its deployed version', () => {
  assert.equal(fs.existsSync(path.join(root, migrationPath)), true);
  assert.ok(fs.statSync(path.join(root, migrationPath)).size > 0);
});
