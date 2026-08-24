import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const releasePath = 'supabase/migrations/20260823233129_farm_terminal_census_v2_release_contract.sql';
const registryPath = 'supabase/migrations/20260823233407_farm_terminal_census_v2_rpc_registry_reconciliation_v1.sql';
const selfContainedPath = 'supabase/migrations/20260823235000_farm_terminal_census_v2_self_contained_authority_v1.sql';
const apiBoundaryPath = 'supabase/migrations/20260823235000_continuity_single_product_api_boundary_v1.sql';
const cleanupPath = 'supabase/migrations/20260824000500_remove_superseded_farm_continuity_audit_engines_v1.sql';
const retiredV1Path = 'supabase/migrations/20260824001000_remove_superseded_terminal_census_v1_runtime_v1.sql';
const requirementAuthorityPath = 'supabase/migrations/20260823232534_farm_continuity_terminal_census_requirement_semantics_v2.sql';
const finishedRequirementPath = 'supabase/migrations/20260824002000_requirement_continuity_finished_runtime_name_v1.sql';
const finishedOperationResultPath = 'supabase/migrations/20260824002100_operation_result_continuity_finished_runtime_name_v1.sql';
const finishedTerminalPath = 'supabase/migrations/20260824002200_farm_continuity_finished_runtime_name_v1.sql';

test('terminal farm continuity has one self-contained canonical current-state authority', () => {
  const canonical = read(selfContainedPath);
  assert.match(canonical, /create or replace function atlas\.farm_continuity_terminal_census_v2/);
  assert.match(canonical, /from atlas\.crop_cycles cc/);
  assert.match(canonical, /cc\.lifecycle_status = 'active'/);
  assert.match(canonical, /atlas\.crop_cycle_reality_expression_v8\(cp\.id\)/);
  assert.match(canonical, /v_req := atlas\.requirement_continuity_audit_v2\(p_farm_id,v_day\)/);
  assert.match(canonical, /v_result := atlas\.operation_result_continuity_audit_v1\(p_farm_id,v_day\)/);
  assert.doesNotMatch(canonical, /farm_continuity_terminal_census_v1\s*\(/);
  assert.match(canonical, /canonicalTerminalCensusComputesCurrentPopulationDirectly/);
  assert.match(canonical, /supersededTerminalVersionsAreNotExecutionDependencies/);
});

test('Requirement Continuity v2 is self-contained when introduced and v1 is runtime history only', () => {
  const requirement = read(requirementAuthorityPath);
  assert.match(requirement, /pg_get_functiondef/);
  assert.match(requirement, /replace\(v_def,'requirement_continuity_audit_v1','requirement_continuity_audit_v2'\)/);
  assert.match(requirement, /worker_day_task_placements/);
  assert.match(requirement, /task_execution_readiness_v1/);
  assert.match(requirement, /v_old_predicate/);
  assert.match(requirement, /legacy progression diagnostic block/);
  assert.match(requirement, /canonicalRequirementContinuityComputesCurrentPopulationDirectly/);
  assert.match(requirement, /supersededRequirementVersionsAreNotExecutionDependencies/);
  assert.match(requirement, /drop function atlas\.requirement_continuity_audit_v1\(uuid,date\) restrict/i);
  assert.match(requirement, /revoke all on function atlas\.requirement_continuity_audit_v2\(uuid,date\) from public,anon,authenticated/i);
  assert.match(requirement, /grant execute on function atlas\.requirement_continuity_audit_v2\(uuid,date\) to service_role/i);
  assert.doesNotMatch(requirement, /v_base := atlas\.requirement_continuity_audit_v1/);
  assert.doesNotMatch(requirement, /cascade/i);
});

test('Atlas-wide farm continuity is cut over to terminal census v2 rather than the legacy audit wrapper chain', () => {
  const release = read(releasePath);
  assert.match(release, /replace\(v_def,'farm_continuity_terminal_census_v1','farm_continuity_terminal_census_v2'\)/);
  assert.match(release, /Farm operating-unit continuity is routed through canonical farm_continuity_terminal_census_v2/);
  for (let version = 1; version <= 10; version += 1) {
    assert.doesNotMatch(
      release.slice(release.indexOf('do $migration$')),
      new RegExp(`farm_continuity_audit_v${version}\\s*\\(`),
      `Atlas-wide cutover must not route through legacy farm_continuity_audit_v${version}`,
    );
  }
});

test('superseded terminal census v1 is absent from the finished executable schema', () => {
  const retiredV1 = read(retiredV1Path);
  assert.match(retiredV1, /delete from atlas\.authenticated_rpc_registry/i);
  assert.match(retiredV1, /signature = 'atlas\.farm_continuity_terminal_census_v1\(uuid, date\)'/);
  assert.match(retiredV1, /drop function if exists atlas\.farm_continuity_terminal_census_v1\(uuid,date\) restrict/i);
  assert.match(retiredV1, /migration history only/i);
  assert.doesNotMatch(retiredV1, /cascade/i);
});

test('canonical terminal census v2 and lower-level continuity proofs remain service-internal during convergence', () => {
  const canonical = read(selfContainedPath);
  const registry = read(registryPath);

  assert.match(canonical, /revoke execute on function atlas\.farm_continuity_terminal_census_v2\(uuid,date\) from public, anon, authenticated/i);
  assert.match(canonical, /grant execute on function atlas\.farm_continuity_terminal_census_v2\(uuid,date\) to service_role/i);

  for (const signature of [
    'atlas.farm_continuity_terminal_census_v2(uuid, date)',
    'atlas.requirement_continuity_audit_v2(uuid, date)',
  ]) {
    assert.ok(registry.includes(`'${signature}'`));
  }
  assert.match(registry, /'service_internal','verified','active'/);
  assert.match(registry, /false,true,true,1,1/);
});

test('superseded farm continuity audit engines are absent from the finished executable schema', () => {
  const cleanup = read(cleanupPath);
  assert.match(cleanup, /proname ~ '\^farm_continuity_audit_v\[0-9\]\+\$'/);
  assert.match(cleanup, /drop function %s restrict/i);
  assert.match(cleanup, /delete from atlas\.authenticated_rpc_registry/i);
  assert.match(cleanup, /migration history remains provenance only/i);
  assert.match(cleanup, /Historical farm_continuity_audit_vN engines have been removed from the executable schema/i);
  const executableCleanup = cleanup.replace(/--.*$/gm, '');
  assert.doesNotMatch(executableCleanup, /\bcascade\b/i);
});

test('continuity has one explicit product API and exactly three current internal proof surfaces during convergence', () => {
  const boundary = read(apiBoundaryPath);
  for (const helper of [
    'atlas.farm_continuity_terminal_census_v2(uuid,date)',
    'atlas.requirement_continuity_audit_v2(uuid,date)',
    'atlas.operation_result_continuity_audit_v1(uuid,date)',
  ]) {
    assert.ok(boundary.includes(helper), `missing explicit continuity helper ${helper}`);
  }
  assert.match(boundary, /to_regprocedure\('atlas\.atlas_wide_continuity_summary_v1\(uuid,date\)'\)/);
  assert.match(boundary, /revoke execute on function atlas\.atlas_wide_continuity_summary_v1\(uuid,date\) from public, anon/i);
  assert.match(boundary, /grant execute on function atlas\.atlas_wide_continuity_summary_v1\(uuid,date\) to authenticated, service_role/i);
  assert.match(boundary, /classification = 'service_internal'/);
  assert.match(boundary, /canonicalProductAuthority', 'atlas\.atlas_wide_continuity_summary_v1'/);
  assert.match(boundary, /exactly the current terminal census, Requirement Continuity, and Operation→Result continuity proofs/i);
  assert.doesNotMatch(boundary, /proname ~ '\^.*continuity.*v\[0-9\]/i);
  assert.doesNotMatch(boundary, /for r in\s+select p\.oid/i);
});

test('finished Requirement Continuity has one stable unversioned runtime identity', () => {
  const migration = read(finishedRequirementPath);
  assert.match(migration, /rename to requirement_continuity_audit/);
  assert.match(migration, /replace\(v_def,'requirement_continuity_audit_v2','requirement_continuity_audit'\)/);
  assert.match(migration, /delete from atlas\.authenticated_rpc_registry/);
  assert.match(migration, /signature='atlas\.requirement_continuity_audit_v2\(uuid, date\)'/);
  assert.match(migration, /'atlas\.requirement_continuity_audit\(uuid, date\)'/);
  assert.match(migration, /numbered predecessor names remain migration history only/i);
});

test('finished Operation Result Continuity has one stable unversioned runtime identity', () => {
  const migration = read(finishedOperationResultPath);
  assert.match(migration, /rename to operation_result_continuity_audit/);
  assert.match(migration, /replace\(v_def,'operation_result_continuity_audit_v1','operation_result_continuity_audit'\)/);
  assert.match(migration, /delete from atlas\.authenticated_rpc_registry/);
  assert.match(migration, /signature='atlas\.operation_result_continuity_audit_v1\(uuid, date\)'/);
  assert.match(migration, /'atlas\.operation_result_continuity_audit\(uuid, date\)'/);
  assert.match(migration, /numbered predecessor names remain migration history only/i);
});

test('finished terminal farm continuity has one stable unversioned runtime identity', () => {
  const migration = read(finishedTerminalPath);
  assert.match(migration, /rename to farm_continuity_terminal_census/);
  assert.match(migration, /replace\(v_def,'farm_continuity_terminal_census_v2','farm_continuity_terminal_census'\)/);
  assert.match(migration, /delete from atlas\.authenticated_rpc_registry/);
  assert.match(migration, /signature='atlas\.farm_continuity_terminal_census_v2\(uuid, date\)'/);
  assert.match(migration, /'atlas\.farm_continuity_terminal_census\(uuid, date\)'/);
  assert.match(migration, /numbered terminal census names remain migration history only/i);
});
