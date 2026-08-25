import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migrationPath = 'supabase/migrations/20260823211943_knowledge_acquisition_search_knower_and_owner_queue_v1.sql';
const firstAnswerPath = 'supabase/migrations/20260823212832_owner_needs_from_you_answer_membrane_v1.sql';
const propagationPath = 'supabase/migrations/20260823212930_owner_needs_from_you_answer_propagation_v1.sql';
const retirePath = 'supabase/migrations/20260823213042_retire_broken_owner_needs_from_you_answer_overload_v2.sql';
const finalFixPath = 'supabase/migrations/20260823213140_fix_owner_unknown_transition_signature_v1.sql';
const workerPrototypePath = 'supabase/migrations/20260823214102_truth_acquisition_worker_observation_adapter_v1.sql';
const workerPrototypeFixPath = 'supabase/migrations/20260823214157_fix_truth_acquisition_observation_carrier_sync_type_v1.sql';
const workerBridgePath = 'supabase/migrations/20260823214200_worker_truth_acquisition_observation_bridge_v1.sql';
const workerConsolidationPath = 'supabase/migrations/20260823214330_consolidate_worker_truth_acquisition_bridge_v1.sql';
const workerOperationFixPath = 'supabase/migrations/20260823214334_worker_truth_observation_operation_class_fix_v1.sql';

const migration = () => read(migrationPath);
const propagation = () => read(propagationPath);
const retire = () => read(retirePath);
const finalFix = () => read(finalFixPath);
const workerBridge = () => read(workerBridgePath);
const workerConsolidation = () => read(workerConsolidationPath);
const workerOperationFix = () => read(workerOperationFixPath);

test('Tranche 1A search-before-ask contract is explicit and preserves epistemic boundaries', () => {
  const sql = migration();
  assert.match(sql, /truth_acquisition_search_v1/);
  for (const source of ['canonical_current_state','explicit_management_decisions','observations','structured_task_results','resource_records','project_place_crop_records','related_operations_and_occurrences','structured_historical_evidence','weak_notes']) assert.match(sql, new RegExp(source));
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
  for (const classification of ['owner_known','worker_observable','management_known','external_information_required','contradictory','actually_unknown']) assert.match(sql, new RegExp(classification));
  for (const surface of ['atlas_needs_from_you','worker_observation','management_acquisition','external_research_handoff','owner_review','unresolved_unknown']) assert.match(sql, new RegExp(surface));
  assert.match(sql, /already_known/);
  assert.match(sql, /v_acquisition_surface:='none'/);
  assert.ok(sql.indexOf('v_search:=atlas.truth_acquisition_search_v1') < sql.indexOf("v_knower_class:=coalesce"), 'search must occur before unresolved knower classification');
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
  assert.ok(triggerFunction.indexOf('truth_acquisition_knower_v1(new.id)') < triggerFunction.indexOf('ensure_truth_acquisition_task_v1(new.id)'), 'knower resolution must precede task carrier creation');
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

test('Tranche 1D final Owner destination answer writes canonical truth and requires synchronous propagation', () => {
  const sql = propagation();
  assert.match(sql, /answer_owner_needs_from_you_v1/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /active and role='owner'/);
  assert.match(sql, /truth_acquisition_knower_v1\(v_instance\.id\)/);
  assert.match(sql, /acquisitionSurface'<>'atlas_needs_from_you'/);
  assert.match(sql, /record_crop_destination_claim_v1/);
  assert.match(sql, /'committed'/);
  assert.match(sql, /'principal'/);
  assert.match(sql, /'owner_knowledge_acquisition'/);
  assert.match(sql, /reconcile_crop_cycle_requirement_state_v1/);
  assert.match(sql, /Canonical destination was recorded but the acquisition consequence did not resolve; transaction rolled back/);
  assert.match(sql, /answerRecordedCanonically/);
  assert.match(sql, /carrierTaskNotReality/);
  assert.match(sql, /transactionFailsIfPropagationFails/);
  assert.ok(sql.indexOf('record_crop_destination_claim_v1') < sql.lastIndexOf('reconcile_crop_cycle_requirement_state_v1'), 'canonical truth must be written before requirement reconciliation');
});

test('Tranche 1D destination answer is farm-scoped and records the answering Owner', () => {
  const sql = propagation();
  assert.match(sql, /v_destination\.farm_id is distinct from v_instance\.farm_id/);
  assert.match(sql, /Destination object must belong to the same farm as the question/);
  assert.match(sql, /recorded_by_membership_id=v_member\.id/);
  assert.match(sql, /ownerMembershipId/);
  assert.match(sql, /source','atlas_needs_from_you/);
  assert.match(sql, /p_idempotency_key/);
});

test('Tranche 1D I-do-not-know preserves unknown, removes Owner routing, and keeps source requirement independent', () => {
  const sql = propagation();
  assert.match(sql, /v_answer_kind='i_do_not_know'/);
  assert.match(sql, /ownerKnowledgeResponse/);
  assert.match(sql, /'kind','i_do_not_know'/);
  assert.match(sql, /'knowerClass','actually_unknown'/);
  assert.match(sql, /'acquisitionSurface','unresolved_unknown'/);
  assert.match(sql, /'factResolved',false/);
  assert.match(sql, /unknownRemainsUnknown/);
  assert.match(sql, /sourceRequirementRemainsIndependent/);
  assert.match(sql, /ownerQueueAssignmentRemovedWithoutInventingFact/);
  assert.match(sql, /releaseGeneration/);
});

test('Tranche 1D final unknown transition uses the internal transition signature without spoofing actor membership', () => {
  const sql = finalFix();
  assert.match(sql, /record_task_transition_v1_internal/);
  assert.match(sql, /'owner-does-not-know:'/);
  assert.match(sql, /'answered_by_membership_id',v_member\.id/);
  const callStart = sql.indexOf('v_transition:=atlas.record_task_transition_v1_internal(');
  const callEnd = sql.indexOf(');', callStart);
  const call = sql.slice(callStart, callEnd);
  assert.match(call, /left\('owner-does-not-know:[\s\S]*?\),\s*null,/);
  assert.doesNotMatch(call, /\),\s*v_member\.id,/);
});

test('Tranche 1D retires the broken five-argument overload and keeps the four-argument endpoint canonical', () => {
  const retired = retire();
  const canonical = propagation();
  assert.match(retired, /revoke all on function atlas\.answer_owner_needs_from_you_v1\(uuid,text,uuid,text,text\)/);
  assert.match(retired, /drop function atlas\.answer_owner_needs_from_you_v1\(uuid,text,uuid,text,text\)/);
  assert.match(retired, /review_status='revoked'/);
  assert.match(retired, /replacementSignature','atlas\.answer_owner_needs_from_you_v1\(uuid, text, uuid, text\)'/);
  assert.match(canonical, /grant execute on function atlas\.answer_owner_needs_from_you_v1\(uuid,text,uuid,text\) to authenticated,service_role/);
  assert.match(canonical, /'atlas\.answer_owner_needs_from_you_v1\(uuid, text, uuid, text\)'/);
  assert.match(canonical, /'public_endpoint','verified','active'/);
});

test('Tranche 1E searches canonical crop observation state rather than treating Worker task result fields as truth', () => {
  const sql = workerBridge();
  assert.match(sql, /crop_latest_observation_v1/);
  assert.match(sql, /v_cycle\.metadata->>'latest_observation'=v_observation_key/);
  assert.match(sql, /latest_observation_date/);
  assert.match(sql, /canonical_crop_cycle_observation_state/);
  assert.match(sql, /workerResultFieldAloneDoesNotBecomeTruth/);
});

test('Tranche 1E Worker return writes through the canonical domain writer and fails if canonical search cannot confirm', () => {
  const sql = workerBridge();
  assert.match(sql, /record_worker_truth_observation_v1/);
  assert.match(sql, /record_crop_observation_for_member_v1/);
  assert.match(sql, /Only the routed signed-in worker may return this observation/);
  assert.match(sql, /Returned observation must exactly match the requested governed observation type/);
  assert.match(sql, /Canonical observation was recorded but did not satisfy the truth gap; transaction rolled back/);
  assert.match(sql, /observationBecameCanonicalDomainState/);
  assert.match(sql, /carrierTaskNotReality/);
  assert.match(sql, /transactionFailsIfCanonicalSearchCannotConfirm/);
});

test('Tranche 1E cannot-establish preserves unknown and does not make task completion become fact', () => {
  const sql = workerBridge();
  assert.match(sql, /v_kind='cannot_establish'/);
  assert.match(sql, /workerObservationResponse/);
  assert.match(sql, /'knowerClass','actually_unknown'/);
  assert.match(sql, /'acquisitionSurface','unresolved_unknown'/);
  assert.match(sql, /'fact_resolved',false/);
  assert.match(sql, /unknownRemainsUnknown/);
  assert.match(sql, /taskCompletionDoesNotInventFact/);
});

test('Tranche 1E Worker routing fails closed unless the observation path is executable and the observer is non-arbitrary', () => {
  const sql = workerConsolidation();
  assert.match(sql, /truth_acquisition_worker_observation_support_v1/);
  assert.match(sql, /workerObservationAdapter/);
  assert.match(sql, /crop_observation_v1/);
  assert.match(sql, /searchAdapter/);
  assert.match(sql, /crop_latest_observation_v1/);
  assert.match(sql, /crop_observation_types/);
  assert.match(sql, /authenticated_rpc_registry/);
  assert.match(sql, /workerObservableDoesNotImplyExecutableWorkerPath/);
  assert.match(sql, /workerPathRequiresGovernedCanonicalWriter/);
  assert.match(sql, /doesNotChooseArbitraryWorker/);
  assert.match(sql, /workerObservationRequiresExecutableSupport/);
  assert.match(sql, /v_acquisition_surface:=case when coalesce\(\(v_worker_support->>'available'\)::boolean,false\) then 'worker_observation' else 'unresolved_unknown' end/);
});

test('Tranche 1E consolidates away the prototype live surface while preserving its production migrations', () => {
  const sql = workerConsolidation();
  assert.match(sql, /drop function if exists atlas\.ensure_truth_acquisition_observation_carrier_v1\(uuid\)/);
  assert.match(sql, /drop function if exists atlas\.truth_acquisition_observation_adapter_v1\(uuid\)/);
  assert.match(sql, /drop table if exists atlas\.truth_acquisition_observation_adapters/);
  assert.match(sql, /generalized 21:42 bridge owns Worker acquisition/);
  for (const relative of [workerPrototypePath, workerPrototypeFixPath, workerBridgePath, workerConsolidationPath, workerOperationFixPath]) assert.equal(fs.existsSync(path.join(root, relative)), true, `missing Worker acquisition production source: ${relative}`);
});

test('Tranche 1E uses canonical inspect action taxonomy for observation carriers', () => {
  const sql = workerOperationFix();
  assert.match(sql, /'action_key','inspect'/);
  assert.match(sql, /observation_action_semantics','inspect'/);
  assert.match(sql, /operationClassComesFromCanonicalInspectTaxonomy/);
  assert.doesNotMatch(sql, /'action_key','observe_truth_gap'/);
});

test('knowledge acquisition source retains every exact post-cutover production migration and current custody surface', () => {
  for (const relative of [migrationPath, firstAnswerPath, propagationPath, retirePath, finalFixPath, workerPrototypePath, workerPrototypeFixPath, workerBridgePath, workerConsolidationPath, workerOperationFixPath]) assert.equal(fs.existsSync(path.join(root, relative)), true, `missing production migration source: ${relative}`);
  const expected = JSON.parse(read('docs/architecture/atlas-source-custody-surface-v1.json'));
  assert.equal(expected.families.find((row) => row.familyKey === 'functions')?.artifactCount, 1192);
  assert.equal(expected.families.find((row) => row.familyKey === 'rpc_privileges')?.artifactCount, 473);
  assert.equal(expected.families.find((row) => row.familyKey === 'functions')?.fingerprintSha256, '0835f2cfc9e70b1564fc640dd0dfa6fbc972768baa83382cf7e59298bea3d255');
  assert.equal(expected.families.find((row) => row.familyKey === 'rpc_privileges')?.fingerprintSha256, 'f21ff68b0a196f64efe69f67a1e7f28ebe92edd6b6e1aa9bd29f4ce086814439');
});