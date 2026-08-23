import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migrationPath = 'supabase/migrations/20260823211943_knowledge_acquisition_search_knower_and_owner_queue_v1.sql';

const migration = () => read(migrationPath);

test('Tranche 1A search-before-ask contract is explicit and preserves epistemic boundaries', () => {
  const sql = migration();
  assert.match(sql, /truth_acquisition_search_v1/);
  for (const source of [
    'canonical_current_state',
    'explicit_management_decisions',
    'observations',
    'structured_task_results',
    'resource_records',
    'project_place_crop_records',
    'related_operations_and_occurrences',
    'structured_historical_evidence',
    'weak_notes',
  ]) assert.match(sql, new RegExp(source));
  assert.match(sql, /searchedBeforeAsk/);
  assert.match(sql, /authoritativeAnswerSuppressesAsk/);
  assert.match(sql, /possibleEvidenceDoesNotBecomeFact/);
  assert.match(sql, /weakNotesAreEvidenceOnly/);
  assert.match(sql, /unknownDoesNotBecomeFalseOrZero/);
  assert.match(sql, /crop_destination_claims/);
  assert.match(sql, /authoritative_answer_found/);
  assert.match(sql, /contradictory_answers_found/);
  assert.match(sql, /genuinely_not_found/);
});

test('Tranche 1B knower classification selects one lawful acquisition surface after search', () => {
  const sql = migration();
  assert.match(sql, /truth_acquisition_knower_v1/);
  for (const classification of [
    'owner_known',
    'worker_observable',
    'management_known',
    'external_information_required',
    'contradictory',
    'actually_unknown',
  ]) assert.match(sql, new RegExp(classification));
  for (const surface of [
    'atlas_needs_from_you',
    'worker_observation',
    'management_acquisition',
    'external_research_handoff',
    'owner_review',
    'unresolved_unknown',
  ]) assert.match(sql, new RegExp(surface));
  assert.match(sql, /already_known/);
  assert.match(sql, /v_acquisition_surface:='none'/);
  assert.ok(
    sql.indexOf('v_search:=atlas.truth_acquisition_search_v1') < sql.indexOf("v_knower_class:=coalesce"),
    'search must occur before unresolved knower classification',
  );
  assert.match(sql, /ownerQuestionRequiresSearchFirst/);
  assert.match(sql, /workerObservationRequiresWorkerObservableClass/);
  assert.match(sql, /externalInformationDoesNotBecomeInternalDecision/);
});

test('Atlas Needs From You is an authenticated owner knowledge queue rather than an overdue task list', () => {
  const sql = migration();
  assert.match(sql, /owner_needs_from_you_v1/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /fm\.user_id=v_user_id/);
  assert.match(sql, /fm\.active and fm\.role='owner'/);
  assert.match(sql, /i\.status='open'/);
  assert.match(sql, /i\.consequence_role='truth_acquisition'/);
  assert.match(sql, /k\.packet->>'acquisitionSurface'='atlas_needs_from_you'/);
  assert.match(sql, /notAnOverdueTaskList/);
  assert.match(sql, /questionSurvivedSearchBeforeAsk/);
  assert.match(sql, /answerMustResolveCanonicalTruthNotDismissCard/);
  assert.match(sql, /choose_known_option/);
  assert.match(sql, /i_do_not_know/);
});

test('truth acquisition carrier routing is gated by knower resolution and retains existing requirement machinery', () => {
  const sql = migration();
  const triggerFunction = sql.slice(sql.indexOf('create or replace function atlas.sync_truth_acquisition_carrier_v1'));
  assert.match(triggerFunction, /truth_acquisition_knower_v1\(new\.id\)/);
  assert.match(triggerFunction, /knowledgeAcquisitionSearch/);
  assert.match(triggerFunction, /knowerClass/);
  assert.match(triggerFunction, /acquisitionSurface/);
  assert.match(triggerFunction, /ensure_truth_acquisition_task_v1\(new\.id\)/);
  assert.match(triggerFunction, /in \('atlas_needs_from_you','management_acquisition'\)/);
  assert.ok(
    triggerFunction.indexOf('truth_acquisition_knower_v1(new.id)') < triggerFunction.indexOf('ensure_truth_acquisition_task_v1(new.id)'),
    'knower resolution must precede task carrier creation',
  );
});

test('Owner knowledge queue RPC is explicitly governed and anonymous access remains closed', () => {
  const sql = migration();
  assert.match(sql, /revoke all on function atlas\.owner_needs_from_you_v1\(\) from public,anon/);
  assert.match(sql, /grant execute on function atlas\.owner_needs_from_you_v1\(\) to authenticated,service_role/);
  assert.match(sql, /'atlas\.owner_needs_from_you_v1\(\)'/);
  assert.match(sql, /'public_endpoint','verified','active'/);
  assert.match(sql, /true,false,true,true/);
  assert.match(sql, /'requiresAuthUid',true/);
  assert.match(sql, /'returnsOnlyOwnerMembershipFarms',true/);
  assert.match(sql, /'doesNotMutateTruth',true/);
});

test('knowledge acquisition migration retains exact production version and custody surface reflects live additions', () => {
  assert.equal(fs.existsSync(path.join(root, migrationPath)), true);
  const expected = JSON.parse(read('docs/architecture/atlas-source-custody-surface-v1.json'));
  assert.equal(expected.families.find((row) => row.familyKey === 'functions')?.artifactCount, 1161);
  assert.equal(expected.families.find((row) => row.familyKey === 'rpc_privileges')?.artifactCount, 469);
  assert.equal(expected.families.find((row) => row.familyKey === 'functions')?.fingerprintSha256, '04b60074ed5fe907cf4bb2c8d35d67d3735964dac360a75a92b731c635e05add');
  assert.equal(expected.families.find((row) => row.familyKey === 'rpc_privileges')?.fingerprintSha256, 'a9f08360724e99bf7e6c8079b2a92bff0a88e8e26d2c8a1d4f1f9aad6193bbec');
});
