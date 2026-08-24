import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const adapterPath = 'supabase/migrations/20260823214102_truth_acquisition_worker_observation_adapter_v1.sql';
const adapterFixPath = 'supabase/migrations/20260823214157_fix_truth_acquisition_observation_carrier_sync_type_v1.sql';
const bridgePath = 'supabase/migrations/20260823214200_worker_truth_acquisition_observation_bridge_v1.sql';
const consolidatePath = 'supabase/migrations/20260823214330_consolidate_worker_truth_acquisition_bridge_v1.sql';
const operationFixPath = 'supabase/migrations/20260823214334_worker_truth_observation_operation_class_fix_v1.sql';

for (const relative of [adapterPath, adapterFixPath, bridgePath, consolidatePath, operationFixPath]) {
  test(`production worker-observation migration is retained exactly by version: ${path.basename(relative)}`, () => {
    assert.equal(fs.existsSync(path.join(root, relative)), true);
    assert.ok(fs.statSync(path.join(root, relative)).size > 0);
  });
}

test('1E searches canonical crop observation state rather than treating a submitted field as truth', () => {
  const sql = read(bridgePath);
  assert.match(sql, /v_search_adapter='crop_latest_observation_v1'/);
  assert.match(sql, /metadata->>'latest_observation'=v_observation_key/);
  assert.match(sql, /metadata->>'latest_observation_date'/);
  assert.match(sql, /authority','canonical_crop_cycle_observation_state'/);
  assert.match(sql, /workerResultFieldAloneDoesNotBecomeTruth/);
  assert.match(sql, /record_crop_observation_for_member_v1/);
  assert.match(sql, /Canonical observation was recorded but did not satisfy the truth gap; transaction rolled back/);
  assert.ok(sql.indexOf('record_crop_observation_for_member_v1') < sql.lastIndexOf('truth_acquisition_search_v1(v_instance.id)'), 'canonical domain observation must be written before search confirms the fact');
});

test('1E final support proof fails closed unless the observation path is executable and governed', () => {
  const sql = read(consolidatePath);
  assert.match(sql, /truth_acquisition_worker_observation_support_v1/);
  assert.match(sql, /v_declared_knower<>'worker_observable'/);
  assert.match(sql, /v_adapter<>'crop_observation_v1'/);
  assert.match(sql, /v_search_adapter<>'crop_latest_observation_v1'/);
  assert.match(sql, /crop_observation_types/);
  assert.match(sql, /to_regprocedure\(v_public_sig\)/);
  assert.match(sql, /to_regprocedure\(v_domain_sig\)/);
  assert.match(sql, /authenticated_rpc_registry/);
  assert.match(sql, /review_status<>'active'/);
  assert.match(sql, /anonymous_execute_expected/);
  assert.match(sql, /writer_contract_unavailable/);
  assert.match(sql, /workerPathRequiresGovernedCanonicalWriter/);
  assert.match(sql, /workerObservableDoesNotImplyExecutableWorkerPath/);
});

test('1E does not arbitrarily choose among multiple workers', () => {
  const sql = read(consolidatePath);
  assert.match(sql, /role='farm_hand'/);
  assert.match(sql, /if v_worker_count=1 then/);
  assert.match(sql, /observer_unresolved/);
  assert.match(sql, /doesNotChooseArbitraryWorker/);
  assert.match(sql, /existingAssignedCarrierMayResolveObserver/);
  assert.match(sql, /workerNotChosenArbitrarily/);
});

test('1E final knower resolver requires executable worker support before exposing Worker observation', () => {
  const sql = read(consolidatePath);
  assert.match(sql, /v_worker_support:=atlas\.truth_acquisition_worker_observation_support_v1\(v_instance\.id\)/);
  assert.match(sql, /when coalesce\(\(v_worker_support->>'available'\)::boolean,false\) then 'worker_observation' else 'unresolved_unknown'/);
  assert.match(sql, /workerObservationRequiresExecutableSupport/);
  assert.match(sql, /workerObservationRequiresWorkerObservableClass/);
});

test('1E final carrier is legitimate assigned work through the existing occurrence engine', () => {
  const sql = read(operationFixPath);
  assert.match(sql, /truth_acquisition_worker_observation_plan_v1/);
  assert.match(sql, /plan_work_occurrence_v1/);
  assert.match(sql, /materialize_specific_work_occurrence_v1/);
  assert.match(sql, /'visibility_scope','assigned_worker'/);
  assert.match(sql, /'assigned_membership_id',v_plan->>'workerMembershipId'/);
  assert.match(sql, /set work_lane='required',commitment_kind='persistent'/);
  assert.match(sql, /'action_key','inspect'/);
  assert.match(sql, /sky_deferral_mode='never'/);
  assert.match(sql, /task_crop_cycles/);
  assert.match(sql, /'observes','confirmed'/);
  assert.match(sql, /workerReceivesRealObservationAction/);
  assert.match(sql, /taskDoesNotResolveFactByCompletionAlone/);
  assert.match(sql, /operationClassComesFromCanonicalInspectTaxonomy/);
});

test('1E worker return is restricted to the routed signed-in worker and exact carrier', () => {
  const sql = read(bridgePath);
  assert.match(sql, /v_user_id uuid:=auth\.uid\(\)/);
  assert.match(sql, /v_task\.id is distinct from v_instance\.carrier_task_id/);
  assert.match(sql, /Only the routed signed-in worker may return this observation/);
  assert.match(sql, /v_plan->>'workerMembershipId'<>v_member\.id::text/);
  assert.match(sql, /Worker observation routing is no longer valid/);
  assert.match(sql, /Returned observation must exactly match the requested governed observation type/);
});

test('1E cannot-establish branch preserves unknown and closes only the obsolete carrier', () => {
  const sql = read(bridgePath);
  assert.match(sql, /v_kind='cannot_establish'/);
  assert.match(sql, /workerObservationResponse/);
  assert.match(sql, /'knowerClass','actually_unknown'/);
  assert.match(sql, /'acquisitionSurface','unresolved_unknown'/);
  assert.match(sql, /'factResolved',false/);
  assert.match(sql, /record_task_transition_v1_internal/);
  assert.match(sql, /'completion_source','worker_not_knower'/);
  assert.match(sql, /unknownRemainsUnknown/);
  assert.match(sql, /taskCompletionDoesNotInventFact/);
});

test('1E observed branch resolves only after canonical state is independently confirmed', () => {
  const sql = read(bridgePath);
  assert.match(sql, /v_kind not in \('observed','cannot_establish'\)/);
  assert.match(sql, /record_crop_observation_for_member_v1/);
  assert.match(sql, /v_search:=atlas\.truth_acquisition_search_v1\(v_instance\.id\)/);
  assert.match(sql, /v_search->>'verdict'<>'authoritative_answer_found'/);
  assert.match(sql, /set status='resolved',resolved_at=now\(\)/);
  assert.match(sql, /canonicalObservationResult/);
  assert.match(sql, /resolutionSearch/);
  assert.match(sql, /observationBecameCanonicalDomainState/);
  assert.match(sql, /transactionFailsIfCanonicalSearchCannotConfirm/);
});

test('1E worker endpoint is authenticated and anonymous execution stays closed', () => {
  const sql = read(bridgePath);
  assert.match(sql, /revoke all on function atlas\.record_worker_truth_observation_v1\(uuid,uuid,text,text,numeric,text,text,text\) from public,anon/);
  assert.match(sql, /grant execute on function atlas\.record_worker_truth_observation_v1\(uuid,uuid,text,text,numeric,text,text,text\) to authenticated,service_role/);
  assert.match(sql, /'atlas\.record_worker_truth_observation_v1\(uuid, uuid, text, text, numeric, text, text, text\)'/);
  assert.match(sql, /'public_endpoint','verified','active'/);
  assert.match(sql, /'requiresRoutedWorker',true/);
  assert.match(sql, /'taskCompletionAloneDoesNotResolveFact',true/);
});

test('1E prototype registry is retained as deployment provenance but removed from final executable surface', () => {
  const prototype = read(adapterPath);
  const consolidated = read(consolidatePath);
  assert.match(prototype, /truth_acquisition_observation_adapters/);
  assert.match(prototype, /ensure_truth_acquisition_observation_carrier_v1/);
  assert.match(consolidated, /drop function if exists atlas\.ensure_truth_acquisition_observation_carrier_v1\(uuid\)/);
  assert.match(consolidated, /drop function if exists atlas\.truth_acquisition_observation_adapter_v1\(uuid\)/);
  assert.match(consolidated, /drop table if exists atlas\.truth_acquisition_observation_adapters/);
});

test('1E guarantees remain present under the current governed Atlas surface', () => {
  const expected = JSON.parse(read('docs/architecture/atlas-source-custody-surface-v1.json'));
  assert.equal(expected.families.find((row) => row.familyKey === 'functions')?.artifactCount, 1180);
  assert.equal(expected.families.find((row) => row.familyKey === 'rpc_privileges')?.artifactCount, 472);
  assert.equal(expected.families.find((row) => row.familyKey === 'functions')?.fingerprintSha256, 'c6f126092a1986a53649e7ce1e540447f3a6dde0ac2e644e75e542652f39c16c');
  assert.equal(expected.families.find((row) => row.familyKey === 'rpc_privileges')?.fingerprintSha256, 'bc7312bbe38dbd5c2a5b5ed3fe865b9c31bc0d420fca8291d85ae649825a3c33');
});