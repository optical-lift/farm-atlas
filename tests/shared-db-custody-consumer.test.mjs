import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Farm Atlas consumes post-fence database authority from noel-core-db', () => {
  const guard = read('scripts/check-shared-db-migration-custody.sh');
  const verifier = read('scripts/verify-shared-db-atlas-authority.sh');
  const contract = read('docs/architecture/shared-db-custody-consumer-v1.md');

  assert.match(guard, /fence_version="20260825203448"/);
  assert.match(guard, /authority_repo="optical-lift\/noel-core-db"/);
  assert.match(verifier, /fence_version="20260825203448"/);
  assert.match(verifier, /authority_repo="optical-lift\/noel-core-db"/);
  assert.match(verifier, /custody\/production-baseline-v1\.json/);
  assert.match(verifier, /shared_db_custody_release_packet_v1/);
  assert.match(verifier, /productRepositoriesMayOwnNewCanonicalMigrations/);
  assert.match(verifier, /farm_atlas_frozen_surface_anchor_differs_from_noel_core_db/);
  assert.match(verifier, /name\.startswith\("atlas_"\)/);
  assert.match(verifier, /canonical_blob_mismatch/);
  assert.match(verifier, /raw\.githubusercontent\.com/);
  assert.doesNotMatch(verifier, /Accept-Profile: atlas/);
  assert.doesNotMatch(verifier, /atlas_rpc_drift/);
  assert.doesNotMatch(verifier, /"\$ATLAS_SOURCE_CUSTODY_API_URL"\s*>\s*"\$atlas_packet"/);

  assert.match(contract, /optical-lift\/farm-atlas` owns Atlas \*\*application source\*\*/i);
  assert.match(contract, /optical-lift\/noel-core-db` owns \*\*executable database migration source\*\*/i);
  assert.match(contract, /frozen executable-surface anchor/i);
  assert.match(contract, /public shared-database custody packet/i);
  assert.match(contract, /legacy Atlas-specific packet became internal\/service-only/i);
  assert.match(contract, /does not copy post-fence migrations back into Farm Atlas/i);
});

test('Atlas CI uses the shared-database consumer verifier instead of the obsolete local-surface release gate', () => {
  const workflow = read('.github/workflows/atlas-ci.yml');
  assert.match(workflow, /Verify shared database consumer custody/);
  assert.match(workflow, /node --test tests\/shared-db-custody-consumer\.test\.mjs/);
  assert.match(workflow, /bash scripts\/verify-shared-db-atlas-authority\.sh/);
  assert.doesNotMatch(workflow, /npm run sync:atlas:source/);
});
