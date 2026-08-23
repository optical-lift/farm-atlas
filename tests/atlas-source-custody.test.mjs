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

test('production-live Atlas management migrations recovered by source-custody slice remain in repository source', () => {
  for (const relative of recoveredProductionSources) {
    const absolute = path.join(root, relative);
    assert.equal(fs.existsSync(absolute), true, `missing recovered production source: ${relative}`);
    assert.ok(fs.statSync(absolute).size > 0, `recovered production source is empty: ${relative}`);
  }
});

test('source-custody contract remains explicit about the single-authority boundary', () => {
  const contract = fs.readFileSync(path.join(root, 'docs/architecture/atlas-source-custody.md'), 'utf8');
  assert.match(contract, /Repository `main` — executable source authority/i);
  assert.match(contract, /Supabase production — deployed-state evidence/i);
  assert.match(contract, /Intelligence Network is a separate product/i);
  assert.match(contract, /parity-only/i);
});
