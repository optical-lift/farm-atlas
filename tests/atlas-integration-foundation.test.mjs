import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const contractPath = "lib/atlas/integrations/contract.ts";
const adapterPath = "lib/atlas/integrations/adapter.ts";
const architecturePath = "docs/architecture/atlas-integration-foundation-v1.md";

test("integration foundation is UI and hosting independent", () => {
  const source = `${read(contractPath)}\n${read(adapterPath)}`;

  assert.doesNotMatch(source, /from\s+["']next(?:\/|["'])/i);
  assert.doesNotMatch(source, /from\s+["']react(?:\/|["'])/i);
  assert.doesNotMatch(source, /@vercel\//i);
  assert.doesNotMatch(source, /app\/api\/atlas/i);
  assert.doesNotMatch(source, /OwnerOperatorMode|FarmDashboard|farm-dashboard/i);
});

test("integration capture cannot claim canonical domain authority", () => {
  const contract = read(contractPath);
  const adapter = read(adapterPath);

  assert.match(contract, /IntegrationAuthority = "evidence_only" \| "domain_adapter_required"/);
  assert.match(contract, /IntegrationEvidenceDraft/);
  assert.match(adapter, /toEvidence\(/);
  assert.match(adapter, /authorityBoundary/);
  assert.doesNotMatch(contract, /"canonical_authority"|"governing_authority"/);
});

test("integration contract carries custody, idempotency, provenance, and distinct time semantics", () => {
  const contract = read(contractPath);

  assert.match(contract, /IntegrationCustody/);
  assert.match(contract, /idempotencyKey/);
  assert.match(contract, /sourceContentSha256/);
  assert.match(contract, /sourceEventRef/);
  assert.match(contract, /occurredAt/);
  assert.match(contract, /observedAt/);
  assert.match(contract, /effectiveFrom/);
  assert.match(contract, /receivedAt/);
});

test("canonical connected source contract stores secret handles, never reusable secret values", () => {
  const contract = read(contractPath);
  const architecture = read(architecturePath);

  assert.match(contract, /IntegrationSecretHandle/);
  assert.match(contract, /secretRef: string/);
  assert.match(architecture, /No password, OAuth access token, OAuth refresh token, API secret, private key, bearer token, or reusable webhook secret/i);

  // Secret-value-shaped fields do not belong in the provider-neutral source contract.
  assert.doesNotMatch(contract, /\b(accessToken|refreshToken|apiKey|clientSecret|webhookSecret|password)\s*:/);
});

test("farm-atlas integration work preserves shared database migration custody", () => {
  const architecture = read(architecturePath);
  const guard = read("scripts/check-shared-db-migration-custody.sh");

  assert.match(architecture, /optical-lift\/noel-core-db/);
  assert.match(architecture, /does not claim database-migration authority/i);
  assert.match(guard, /authority_repo="optical-lift\/noel-core-db"/);
  assert.match(guard, /fence_version="20260825203448"/);
});
