import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migrationPath = 'supabase/migrations/20260823211943_knowledge_acquisition_search_knower_and_owner_queue_v1.sql';
const answerMigrationPath = 'supabase/migrations/20260823212832_owner_needs_from_you_answer_membrane_v1.sql';

const migration = () => read(migrationPath);
const answerMigration = () => read(answerMigrationPath);

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

test('Tranche 1D Owner destination answer writes canonical domain truth and reuses requirement reconciliation', () => {
  const sql = answerMigration();
  assert.match(sql, /answer_owner_needs_from_you_v1/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /active and role='owner'/);
  assert.match(sql, /truth_acquisition_knower_v1\(v_instance\.id\)/);
  assert.match(sql, /acquisitionSurface'<>'atlas_needs_from_you'/);
  assert.match(sql, /record_crop_destination_claim_v1/);
  assert.match(sql, /'committed'/);
  assert.match(sql, /'owner_needs_from_you'/);
  assert.match(sql, /reconcile_crop_cycle_requirement_state_v1/);
  assert.match(sql, /answerWrittenToCanonicalDomainTruth/);
  assert.match(sql, /carrierTaskNotUsedAsTruthStore/);
  assert.match(sql, /downstreamExecutionReevaluatedByExistingResolutionTrigger/);
  assert.ok(
    sql.indexOf('record_crop_destination_claim_v1') < sql.lastIndexOf('reconcile_crop_cycle_requirement_state_v1'),
    'canonical truth must be written before requirement reconciliation',
  );
});

test('Tranche 1D I-do-not-know preserves the unknown and removes false Owner-knower routing', () => {
  const sql = answerMigration();
  assert.match(sql, /p_answer_kind='i_do_not_know'/);
  assert.match(sql, /ownerUnableToAnswer/);
  assert.match(sql, /v_knower_class:='actually_unknown'/);
  assert.match(sql, /v_acquisition_surface:='unresolved_unknown'/);
  assert.match(sql, /unknownWasNotConvertedToFact/);
  assert.match(sql, /sourceRequirementRemainsOpen/);
  assert.match(sql, /ownerCardRemovedFromOwnerKnownLane/);
});

test('Tranche 1D protects idempotency, farm boundary, and internal writer boundary', () => {
  const sql = answerMigration();
  assert.match(sql, /growing_objects/);
  assert.match(sql, /farm_id=v_instance\.farm_id/);
  assert.match(sql, /owner-needs-from-you:/);
  assert.match(sql, /different destination/);
  assert.match(sql, /revoke all on function atlas\.answer_owner_needs_from_you_v1/);
  assert.match(sql, /grant execute on function atlas\.answer_owner_needs_from_you_v1\(uuid,text,uuid,text,text\) to authenticated,service_role/);
  assert.match(sql, /doesNotExposeInternalDestinationWriter/);
});

test('knowledge acquisition migrations retain exact production versions and custody surface reflects live additions', () => {
  assert.equal(fs.existsSync(path.join(root, migrationPath)), true);
  assert.equal(fs.existsSync(path.join(root, answerMigrationPath)), true);
  const expected = JSON.parse(read('docs/architecture/atlas-source-custody-surface-v1.json'));
  assert.equal(expected.families.find((row) => row.familyKey === 'functions')?.artifactCount, 1162);
  assert.equal(expected.families.find((row) => row.familyKey === 'rpc_privileges')?.artifactCount, 470);
  assert.equal(expected.families.find((row) => row.familyKey === 'functions')?.fingerprintSha256, '6c7cf1047e4028c29d279aa1221042a33be82c99fc7bbae46bad580ebcd0f274');
  assert.equal(expected.families.find((row) => row.familyKey === 'rpc_privileges')?.fingerprintSha256, '5c90954a99230a6c36516c75416cacea6399a1f61e5269a03058d9ff648486f4');
});
