import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const recoveredMigrations = [
  '20260729170000_add_owner_day_api_v1.sql',
  '20260730225500_phase13_buyer_outreach_v1.sql',
  '20260731020000_remediate_rpc_privileges_v1.sql',
  '20260801040600_unify_application_identity_v2.sql',
  '20260803223651_add_worker_execution_contract_v1.sql',
  '20260803224108_add_runtime_endpoint_registry_v1.sql',
  '20260804174146_add_task_state_machine_v1.sql',
  '20260807122454_harden_manager_engine_delegation_v1.sql',
  '20260807162440_knowledge_governance_hardening_v1.sql',
  '20260818151806_disable_legacy_sow_dispatch_v1.sql',
  '20260818180252_embed_sowing_cadence_in_crop_cycle_v1.sql',
  '20260818191352_authoritative_sow_task_payload_v2.sql',
  '20260818193915_retire_legacy_worker_day_api_v1.sql',
  '20260819144840_venue_completion_membrane_v1.sql',
  '20260819153751_restore_venue_task_completion_guard_v2.sql',
  '20260819162710_restore_daily_worker_day_calendar_v1.sql',
  '20260819163251_worker_day_commitment_completion_guard_v1.sql',
  '20260819163711_worker_day_calendar_overnight_transfer_v1.sql',
  '20260819164039_worker_day_calendar_replan_destination_v1.sql',
  '20260819164656_worker_day_calendar_reopen_replan_destination_v1.sql',
];

for (const migration of recoveredMigrations) {
  test(`recovered production-live source exists: ${migration}`, () => {
    assert.equal(fs.existsSync(path.join(root, 'supabase/migrations', migration)), true);
  });
}

test('recovered production-live Atlas management source remains present', () => {
  for (const migration of recoveredMigrations) {
    assert.equal(fs.existsSync(path.join(root, 'supabase/migrations', migration)), true);
  }
});

test('source-custody contract preserves distinct authorities and separate Intelligence Network boundary', () => {
  const contract = read('docs/architecture/atlas-source-custody.md');
  assert.match(contract, /Repository `main` — executable source authority/i);
  assert.match(contract, /Canonical production state — operational reality/i);
  assert.match(contract, /Supabase migration ledger — deployment provenance/i);
  assert.match(contract, /Source-custody registry — reconciliation memory/i);
  assert.match(contract, /Intelligence Network — separate product/i);
  assert.match(contract, /Manual closure of every historical PR is \*\*not\*\* part of this release gate/i);
});

test('current executable surface equivalence is the primary custody release proof', () => {
  const contract = read('docs/architecture/atlas-source-custody.md');
  const sync = read('scripts/atlas-source-synchronizer.sh');
  const comparator = read('scripts/compare-atlas-source-custody-surface.mjs');
  const expected = JSON.parse(read('docs/architecture/atlas-source-custody-surface-v1.json'));
  assert.match(contract, /Current-state equivalence — primary release proof/i);
  assert.match(sync, /source_custody_release_packet_v1/);
  assert.match(sync, /compare-atlas-source-custody-surface\.mjs/);
  assert.match(comparator, /SURFACE_MISMATCH/);
  assert.match(comparator, /MISSING_LIVE_FAMILY/);
  assert.match(comparator, /UNEXPECTED_LIVE_FAMILY/);
  assert.equal(expected.contractVersion, 1);
  assert.equal(expected.authority, 'repository-main');
  assert.equal(expected.families.reduce((sum, row) => sum + row.artifactCount, 0), 4344);
  assert.equal(expected.families.find((row) => row.familyKey === 'rpc_privileges')?.artifactCount, 473);
  for (const row of expected.families) assert.match(row.fingerprintSha256, /^[0-9a-f]{64}$/);
});

test('production custody registry is append-only, service-only, and catalog-derived', () => {
  const migration = read('supabase/migrations/20260823202957_atlas_source_custody_surface_registry_v1.sql');
  assert.match(migration, /source_custody_surface_families/);
  assert.match(migration, /source_custody_adjudications/);
  assert.match(migration, /append-only/i);
  assert.match(migration, /pg_get_functiondef/);
  assert.match(migration, /pg_policies/);
  assert.match(migration, /pg_get_triggerdef/);
  assert.match(migration, /pg_get_constraintdef/);
  assert.match(migration, /authenticated_rpc_registry/);
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /not like 'source_custody_%'/i);
  assert.match(migration, /grant execute on function atlas\.source_custody_live_surface_v1\(\) to service_role/i);
  assert.match(migration, /revoke all on function atlas\.source_custody_live_surface_v1\(\) from public,anon,authenticated/i);
});

test('custody governance migrations retain exact production versions in repository source', () => {
  const expected = [
    '20260823202957_atlas_source_custody_surface_registry_v1.sql',
    '20260823203337_atlas_source_custody_seed_adjudications_v1.sql',
    '20260823204558_atlas_source_custody_release_packet_v1.sql',
    '20260823204641_atlas_source_custody_release_packet_registry_v1.sql',
    '20260823205508_atlas_source_custody_legacy_epoch_v1.sql',
  ];
  for (const migration of expected) {
    assert.equal(fs.existsSync(path.join(root, 'supabase/migrations', migration)), true, migration);
  }
});

test('legacy provenance epoch is immutable evidence, not a current-surface waiver', () => {
  const policy = JSON.parse(read('docs/architecture/atlas-source-custody-provenance-v1.json'));
  assert.equal(policy.contractVersion, 1);
  assert.equal(policy.authority, 'repository-main');
  assert.equal(policy.exactFromVersion, '20260823202957');
  assert.equal(policy.legacyEpoch.migrationCount, 1171);
  assert.match(policy.legacyEpoch.manifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(policy.legacyEpoch.waivesCurrentSurfaceMismatch, false);
  assert.equal(policy.postCutover.requireExactSource, true);
});

test('Atlas Source Synchronizer enforces surface, legacy epoch binding, then post-cutover exact provenance', () => {
  const sync = read('scripts/atlas-source-synchronizer.sh');
  assert.match(sync, /compare-atlas-source-custody-surface\.mjs/);
  assert.match(sync, /legacy_manifest/);
  assert.match(sync, /surface_nonwaiver/);
  assert.match(sync, /postcutover_exact/);
  assert.match(sync, /SOURCE_SYNC_RPC_DRIFT/);
  assert.match(sync, /reconcile-production-migration-history\.sh/);
  assert.match(sync, /--since/);
  assert.match(sync, /--scope atlas-management/);
});

test('publishable release packet exposes custody metadata only and is explicitly governed', () => {
  const migration = read('supabase/migrations/20260823204641_atlas_source_custody_release_packet_registry_v1.sql');
  assert.match(migration, /source_custody_release_packet_v1\(\)/);
  assert.match(migration, /publishable_readonly/);
  assert.match(migration, /authenticated_execute_expected/);
  assert.match(migration, /anonymous_execute_expected/);
  assert.match(migration, /service_execute_expected/);
});

test('custody engine hard-fails unresolved post-cutover provenance debt', () => {
  const engine = read('scripts/reconcile-production-migration-history.sh');
  assert.match(engine, /POST_CUTOVER_MISSING_SOURCE/);
  assert.match(engine, /POST_CUTOVER_HASH_MISMATCH/);
  assert.match(engine, /POST_CUTOVER_UNEXPECTED_SOURCE/);
  assert.match(engine, /exit 1/);
});

test('known Grow Room timestamp drift remains explicit historical evidence', () => {
  const seed = read('supabase/migrations/20260823203337_atlas_source_custody_seed_adjudications_v1.sql');
  assert.match(seed, /20260727181055/);
  assert.match(seed, /20260727193000_trail_foundation_grow_room_v1\.sql/);
  assert.match(seed, /8fb94ffe8019f9829808a57d51b317614da90151/);
  assert.match(seed, /VERSION_DRIFT_ALIAS|version_drift/i);
});
