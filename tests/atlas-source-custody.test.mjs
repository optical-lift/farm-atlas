import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

const recoveredProductionSources = [
  'supabase/migrations/20260721214054_atlas_unified_workflow_handoffs.sql',
  'supabase/migrations/20260721214203_atlas_migrate_task_handoffs_and_repair_lemon_basil.sql',
  'supabase/migrations/20260721214529_atlas_add_workflow_coverage_audit.sql',
  'supabase/migrations/20260721230827_atlas_classify_workflow_handoffs.sql',
  'supabase/migrations/20260721230913_atlas_add_completion_impact_audit.sql',
  'supabase/migrations/20260721231030_atlas_complete_completion_impact_policy_coverage.sql',
  'supabase/migrations/20260721231615_atlas_seal_workflow_audit_internals.sql',
  'supabase/migrations/20260722010035_atlas_add_production_lot_spine.sql',
  'supabase/migrations/20260722010123_atlas_seed_spring_2027_snapdragon_pilot.sql',
  'supabase/migrations/20260722012002_atlas_add_production_capacity_planner.sql',
  'supabase/migrations/20260722012256_atlas_add_capacity_calculation_and_readiness_views.sql',
  'supabase/migrations/20260722012511_atlas_seed_spring_2027_capacity_pilot.sql',
  'supabase/migrations/20260722012622_atlas_fix_capacity_refresh_function_qualification.sql',
  'supabase/migrations/20260722022823_atlas_add_owner_capacity_assignment_engine.sql',
  'supabase/migrations/20260722023200_atlas_add_owner_capacity_snapshot.sql',
  'supabase/migrations/20260722023535_atlas_add_owner_capacity_mutations.sql',
  'supabase/migrations/20260722025101_atlas_reconcile_capacity_changes_and_bed_assignments.sql',
  'supabase/migrations/20260722040535_atlas_add_production_stage_schema.sql',
  'supabase/migrations/20260722040645_atlas_add_production_sowing_command.sql',
  'supabase/migrations/20260722040745_atlas_add_production_germination_command.sql',
  'supabase/migrations/20260722040832_atlas_seal_production_seedling_engine.sql',
  'supabase/migrations/20260722040911_atlas_add_production_transplant_schema.sql',
  'supabase/migrations/20260722040950_atlas_add_production_seedling_care_command.sql',
  'supabase/migrations/20260722041029_atlas_add_production_transplant_gate.sql',
  'supabase/migrations/20260722041126_atlas_add_production_readiness_command.sql',
  'supabase/migrations/20260722041139_atlas_refresh_transplant_gate_from_bed_prep.sql',
  'supabase/migrations/20260722041248_atlas_add_production_transplant_command.sql',
  'supabase/migrations/20260722041314_atlas_seal_production_transplant_engine.sql',
];

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('production-live Atlas management migrations recovered by source-custody slice remain in repository source', () => {
  for (const relative of recoveredProductionSources) {
    const absolute = path.join(root, relative);
    assert.equal(fs.existsSync(absolute), true, `missing recovered production source: ${relative}`);
    assert.ok(fs.statSync(absolute).size > 0, `recovered production source is empty: ${relative}`);
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
  assert.match(sync, /source_custody_live_surface_v1/);
  assert.match(sync, /compare-atlas-source-custody-surface\.mjs/);
  assert.match(comparator, /SURFACE_MISMATCH/);
  assert.match(comparator, /MISSING_LIVE_FAMILY/);
  assert.match(comparator, /UNEXPECTED_LIVE_FAMILY/);
  assert.equal(expected.contractVersion, 1);
  assert.deepEqual(expected.families.map((row) => row.familyKey).sort(), [
    'constraints', 'functions', 'rls_policies', 'rpc_privileges', 'triggers',
  ]);
  assert.equal(expected.families.reduce((sum, row) => sum + row.artifactCount, 0), 4302);
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

test('Atlas Source Synchronizer uses current surface first and migration provenance second', () => {
  const sync = read('scripts/atlas-source-synchronizer.sh');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['sync:atlas:source'], 'bash scripts/atlas-source-synchronizer.sh');
  assert.match(sync, /node "\$comparator"/);
  assert.match(sync, /atlas\.authenticated_rpc_registry_drift_v1\(\)/);
  assert.match(sync, /source_custody_adjudications/);
  assert.match(sync, /--since 0/);
  assert.match(sync, /--scope atlas-management/);
  assert.match(sync, /ATLAS_SOURCE_SYNC_OK surface=exact rpc_drift=0 migration_provenance=clean/);
  assert.ok(sync.indexOf('node "$comparator"') < sync.indexOf('"$engine"'), 'surface comparison must precede migration archaeology');
});

test('custody engine hard-fails unresolved provenance debt but permits governed identical-byte drift adjudication', () => {
  const engine = read('scripts/reconcile-production-migration-history.sh');
  assert.match(engine, /ADJUDICATED_VERSION_DRIFT/);
  assert.match(engine, /VERSION_DRIFT_MISMATCH/);
  assert.match(engine, /AMBIGUOUS_NAME_DRIFT/);
  assert.match(engine, /missing > 0 \|\| mismatched > 0 \|\| version_drift_match > 0/);
  assert.match(engine, /position\('atlas\.' in lower\(sql\)\) > 0/);
});

test('known Grow Room timestamp drift is governed in append-only production custody source', () => {
  const adjudication = read('supabase/migrations/20260823203337_atlas_source_custody_seed_adjudications_v1.sql');
  assert.match(adjudication, /20260727181055/);
  assert.match(adjudication, /20260727193000_trail_foundation_grow_room_v1\.sql/);
  assert.match(adjudication, /8fb94ffe8019f9829808a57d51b317614da90151/g);
  assert.match(adjudication, /'version_drift','accepted'/);
  assert.equal(fs.existsSync(path.join(root, 'supabase/migrations/20260727193000_trail_foundation_grow_room_v1.sql')), true);
});
