import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const initial = read('supabase/migrations/20260823220114_future_transplant_truth_preflight_v1.sql');
const relationSync = read('supabase/migrations/20260823220606_future_truth_preflight_relation_link_sync_v1.sql');
const snapshotScope = read('supabase/migrations/20260823220700_future_truth_preflight_snapshot_execute_scope_v1.sql');
const cohort = read('supabase/migrations/20260823220746_future_truth_preflight_cohort_lifecycle_v1.sql');
const phaseFix = read('supabase/migrations/20260823220854_future_truth_preflight_phase_source_fix_v1.sql');
const tickConsolidation = read('supabase/migrations/20260823221212_future_truth_preflight_tick_consolidation_v1.sql');
const tickSignature = read('supabase/migrations/20260823221247_future_truth_preflight_tick_signature_fix_v2.sql');

test('1F treats future work as planning evidence and never as a current requirement', () => {
  assert.match(initial, /futureOccurrenceIsPlanningEvidenceNotCurrentRequirement/);
  assert.match(initial, /plannedTargetObjectsAreEvidenceNotCanonicalDestinationTruth/);
  assert.match(initial, /schedulingDoesNotCreateOperationalTruth/);
  assert.match(initial, /doesNotCreateCurrentRequirement/);
  assert.match(initial, /acquisitionPhase','future_preflight'/);
  assert.match(initial, /carrierContract','owner_knowledge_surface_only'/);
  assert.match(initial, /future_preflight'[\s\S]*?return new;/);
});

test('1F recognizes both payload and structured relation links for legitimate future transplant work', () => {
  assert.match(relationSync, /task_payload->'metadata'->'crop_cycle_ids'/);
  assert.match(relationSync, /relation_payload->'task_crop_cycles'/);
  assert.match(relationSync, /structuredOccurrenceRelationsAreRecognized/);
});

test('one future transplant occurrence creates one Owner decision across its crop-cycle cohort', () => {
  assert.match(cohort, /futureOperationCropCycleIds/);
  assert.match(cohort, /decisionRepresentativeCropCycleId/);
  assert.match(cohort, /isDecisionRepresentative/);
  assert.match(cohort, /and v_cycle\.id=v_representative/);
  assert.match(cohort, /oneFutureOccurrenceCreatesOneOwnerDecision/);
});

test('one Owner destination answer propagates canonically and transactionally to every cohort member', () => {
  assert.match(phaseFix, /record_future_transplant_destination_cohort_v1/);
  assert.match(phaseFix, /futureOperationCropCycleIds/);
  assert.match(phaseFix, /foreach v_cycle_id in array v_member_ids/);
  assert.match(phaseFix, /record_crop_destination_claim_v1/);
  assert.match(phaseFix, /reconcile_crop_cycle_requirement_state_v1\(v_cycle_id\)/);
  assert.match(phaseFix, /transaction rolled back/i);
  assert.match(phaseFix, /futurePreflightPropagatesAcrossOccurrenceCohort/);
});

test('future-preflight phase survives normal consequence reconciliation and is not mistaken for an active requirement', () => {
  assert.match(phaseFix, /epistemic_basis->>'acquisitionPhase'/);
  assert.match(phaseFix, /consequence_payload->'policyMetadata'->>'acquisitionPhase'/);
  assert.match(phaseFix, /'active_requirement'/);
});

test('planning snapshot and preflight clocks remain service-only', () => {
  assert.match(snapshotScope, /revoke all on function atlas\.crop_cycle_requirement_snapshot_v1\(uuid,date\) from public,anon,authenticated/i);
  assert.match(snapshotScope, /grant execute on function atlas\.crop_cycle_requirement_snapshot_v1\(uuid,date\) to service_role/i);
  assert.match(tickSignature, /revoke all on function atlas\.future_truth_preflight_tick_v1\(\) from public,anon,authenticated/i);
  assert.match(tickSignature, /revoke all on function atlas\.future_truth_preflight_tick_v1\(date\) from public,anon,authenticated/i);
  assert.match(tickSignature, /grant execute on function atlas\.future_truth_preflight_tick_v1\(\) to service_role/i);
  assert.match(tickSignature, /grant execute on function atlas\.future_truth_preflight_tick_v1\(date\) to service_role/i);
});

test('scheduled and testable preflight lifecycle share one unambiguous implementation', () => {
  assert.match(tickConsolidation, /select atlas\.future_truth_preflight_tick_v1\(\(now\(\) at time zone 'America\/Chicago'\)::date\)/);
  assert.match(tickSignature, /drop function atlas\.future_truth_preflight_tick_v1\(\);/);
  assert.match(tickSignature, /drop function atlas\.future_truth_preflight_tick_v1\(date\);/);
  assert.match(tickSignature, /create function atlas\.future_truth_preflight_tick_v1\(p_as_of_date date\)/);
  assert.doesNotMatch(tickSignature, /p_as_of_date date default/);
  assert.match(tickSignature, /canonicalConsequenceReconcilerOwnsOpenAndClose/);
});
