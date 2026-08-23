import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const releasePath = 'supabase/migrations/20260823233129_farm_terminal_census_v2_release_contract.sql';
const registryPath = 'supabase/migrations/20260823233407_farm_terminal_census_v2_rpc_registry_reconciliation_v1.sql';

test('terminal farm continuity has one canonical current-state authority', () => {
  const release = read(releasePath);
  assert.match(release, /create or replace function atlas\.farm_continuity_terminal_census_v2/);
  assert.match(release, /v_base := atlas\.farm_continuity_terminal_census_v1\(p_farm_id,v_day\)/);
  assert.match(release, /v_req := atlas\.requirement_continuity_audit_v2\(p_farm_id,v_day\)/);
  assert.match(release, /v_result := atlas\.operation_result_continuity_audit_v1\(p_farm_id,v_day\)/);
  assert.match(release, /'Canonical production terminal continuity census/);
  assert.match(release, /'Superseded terminal continuity census retained as an internal lineage\/base proof for v2/);
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

test('terminal census helpers remain service-internal and cannot become authenticated public RPCs', () => {
  const release = read(releasePath);
  const registry = read(registryPath);

  for (const signature of [
    'atlas.farm_continuity_terminal_census_v1(uuid,date)',
    'atlas.farm_continuity_terminal_census_v2(uuid,date)',
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('uuid,date', 'uuid,date');
    assert.match(release, new RegExp(`revoke execute on function ${escaped} from public, anon, authenticated`, 'i'));
    assert.match(release, new RegExp(`grant execute on function ${escaped} to service_role`, 'i'));
  }

  for (const signature of [
    'atlas.farm_continuity_terminal_census_v1(uuid, date)',
    'atlas.farm_continuity_terminal_census_v2(uuid, date)',
    'atlas.requirement_continuity_audit_v2(uuid, date)',
  ]) {
    assert.ok(registry.includes(`'${signature}'`));
  }
  assert.match(registry, /'service_internal','verified','active'/);
  assert.match(registry, /false,true,true,1,1/);
});
