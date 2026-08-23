#!/usr/bin/env bash
set -euo pipefail

# Canonical Atlas executable-source custody membrane.
#
# Hard release proofs:
#   1. current governed executable surface exactly matches repository authority;
#   2. authenticated RPC drift is zero;
#   3. the pre-custody deployment ledger still matches its immutable adjudicated epoch;
#   4. every Atlas-management migration from the custody cutover forward reconciles
#      exactly or through an explicit per-artifact governed adjudication.
#
# Legacy pre-cutover byte discrepancies remain recorded historical debt. They are not
# executable-source authority and cannot waive a current-surface mismatch.

repo_root="$(git rev-parse --show-toplevel)"
engine="$repo_root/scripts/reconcile-production-migration-history.sh"
expected_surface="$repo_root/docs/architecture/atlas-source-custody-surface-v1.json"
provenance_policy="$repo_root/docs/architecture/atlas-source-custody-provenance-v1.json"
comparator="$repo_root/scripts/compare-atlas-source-custody-surface.mjs"

for required in git node; do
  command -v "$required" >/dev/null 2>&1 || { echo "SOURCE_SYNC_INVALID missing_command=$required" >&2; exit 2; }
done

packet="$(mktemp)"
observed_surface="$(mktemp)"
manifest="$(mktemp)"
adjudications="$(mktemp)"
metadata="$(mktemp)"
trap 'rm -f "$packet" "$observed_surface" "$manifest" "$adjudications" "$metadata"' EXIT

if [[ -n "${ATLAS_PRODUCTION_DATABASE_URL:-}" ]]; then
  command -v psql >/dev/null 2>&1 || { echo "SOURCE_SYNC_INVALID missing_command=psql" >&2; exit 2; }
  psql "$ATLAS_PRODUCTION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At \
    -c "select atlas.source_custody_release_packet_v1();" > "$packet"
else
  : "${ATLAS_SOURCE_CUSTODY_API_URL:?Set ATLAS_SOURCE_CUSTODY_API_URL or ATLAS_PRODUCTION_DATABASE_URL}"
  : "${ATLAS_SUPABASE_PUBLISHABLE_KEY:?Set ATLAS_SUPABASE_PUBLISHABLE_KEY for the read-only custody API}"
  command -v curl >/dev/null 2>&1 || { echo "SOURCE_SYNC_INVALID missing_command=curl" >&2; exit 2; }
  curl --fail --silent --show-error \
    --request POST \
    --header "apikey: $ATLAS_SUPABASE_PUBLISHABLE_KEY" \
    --header "Content-Type: application/json" \
    --header "Accept-Profile: atlas" \
    --header "Content-Profile: atlas" \
    --data '{}' \
    "$ATLAS_SOURCE_CUSTODY_API_URL" > "$packet"
fi

node - "$packet" "$provenance_policy" "$observed_surface" "$manifest" "$adjudications" "$metadata" <<'NODE'
const fs = require('node:fs');
const [packetPath, policyPath, surfacePath, manifestPath, adjudicationsPath, metadataPath] = process.argv.slice(2);
const fail = (message) => { console.error(`SOURCE_SYNC_INVALID ${message}`); process.exit(2); };
const parse = (file, label) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`${label}_json=${error.message}`); }
};
let packet = parse(packetPath, 'packet');
const policy = parse(policyPath, 'policy');
if (Array.isArray(packet) && packet.length === 1) packet = packet[0];
if (!packet || packet.contractVersion !== 2 || !packet.surface || !packet.migrationProvenance) fail('malformed_release_packet');
if (policy.contractVersion !== 1 || policy.authority !== 'repository-main') fail('malformed_provenance_policy');
const provenance = packet.migrationProvenance;
if (provenance.scope !== 'atlas-management') fail(`unexpected_scope=${provenance.scope}`);
if (provenance.exactFromVersion !== policy.exactFromVersion) fail(`cutover_packet=${provenance.exactFromVersion}_policy=${policy.exactFromVersion}`);
if (!Array.isArray(packet.surface.families) || !Array.isArray(provenance.manifest)) fail('packet_arrays_missing');

const legacy = provenance.legacyEpoch ?? {};
const live = legacy.live ?? {};
const adjudication = legacy.adjudication ?? {};
const evidence = adjudication.evidence ?? {};
const expectedLegacy = policy.legacyEpoch ?? {};
// legacy_manifest is a hard binding among live ledger fingerprint, append-only adjudication, and repository policy.
const checks = [
  ['custody_key', adjudication.custodyKey, expectedLegacy.custodyKey],
  ['disposition', adjudication.disposition, 'accepted'],
  ['cutover', evidence.cutoverVersion, policy.exactFromVersion],
  ['live_count', Number(live.migration_count), Number(expectedLegacy.migrationCount)],
  ['adjudicated_count', Number(evidence.migrationCount), Number(expectedLegacy.migrationCount)],
  ['live_first', live.first_version, expectedLegacy.firstVersion],
  ['live_last', live.last_version, expectedLegacy.lastVersion],
  ['live_manifest', live.manifest_sha256, expectedLegacy.manifestSha256],
  ['adjudicated_manifest', evidence.manifestSha256, expectedLegacy.manifestSha256],
  ['surface_nonwaiver', evidence.waivesCurrentSurfaceMismatch, false],
  ['postcutover_exact', evidence.postCutoverSourceRequiredExact, true],
];
for (const [label, actual, expected] of checks) if (actual !== expected) fail(`legacy_${label}=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);

fs.writeFileSync(surfacePath, JSON.stringify({ contractVersion: packet.surface.contractVersion, families: packet.surface.families }) + '\n');
const safe = (value, pattern, label) => {
  const text = String(value ?? '');
  if (!pattern.test(text)) fail(`${label}=${JSON.stringify(text)}`);
  return text;
};
const manifestLines = provenance.manifest.map((row) => [
  safe(row.version, /^\d+$/, 'migration_version'),
  safe(row.name, /^[A-Za-z0-9_]+$/, 'migration_name'),
  safe(row.expectedBlobSha, /^[0-9a-f]{40}$/, 'migration_blob_sha'),
].join('\t'));
fs.writeFileSync(manifestPath, manifestLines.join('\n') + (manifestLines.length ? '\n' : ''));

const adjudicationLines = ['# production_version\tproduction_name\tdisposition\trepository_file\tcustody_key'];
for (const row of packet.acceptedVersionDrift ?? []) {
  const e = row.evidence ?? {};
  if (String(e.productionVersion ?? '') < policy.exactFromVersion) continue;
  const stored = safe(e.repositoryFile, /^(?:supabase\/migrations\/)?[A-Za-z0-9_.-]+\.sql$/, 'adjudication_repository_file');
  const repositoryFile = stored.startsWith('supabase/migrations/') ? stored : `supabase/migrations/${stored}`;
  adjudicationLines.push([
    safe(e.productionVersion, /^\d+$/, 'adjudication_production_version'),
    safe(e.productionName, /^[A-Za-z0-9_]+$/, 'adjudication_production_name'),
    'VERSION_DRIFT_ALIAS',
    repositoryFile,
    safe(row.custodyKey, /^[A-Za-z0-9_.:\/-]+$/, 'adjudication_custody_key'),
  ].join('\t'));
}
fs.writeFileSync(adjudicationsPath, adjudicationLines.join('\n') + '\n');

const rpcDrift = Number(packet.rpcDriftCount);
const migrationCount = Number(provenance.migrationCount);
if (!Number.isInteger(rpcDrift) || rpcDrift < 0 || !Number.isInteger(migrationCount) || migrationCount < 0) fail('invalid_packet_counts');
if (migrationCount !== manifestLines.length) fail(`manifest_count=${manifestLines.length} declared=${migrationCount}`);
fs.writeFileSync(metadataPath, JSON.stringify({ rpcDrift, migrationCount, exactFromVersion: policy.exactFromVersion, legacyCount: expectedLegacy.migrationCount }) + '\n');
NODE

node "$comparator" "$expected_surface" "$observed_surface"

rpc_drift="$(node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(m.rpcDrift));' "$metadata")"
if ((rpc_drift > 0)); then
  echo "SOURCE_SYNC_RPC_DRIFT unresolved=$rpc_drift" >&2
  exit 1
fi

exact_from="$(node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(m.exactFromVersion);' "$metadata")"
bash "$engine" \
  --check \
  --since "$exact_from" \
  --scope atlas-management \
  --manifest "$manifest" \
  --adjudications "$adjudications"

node - "$metadata" <<'NODE'
const fs = require('node:fs');
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(`ATLAS_SOURCE_SYNC_OK surface=exact rpc_drift=0 legacy_epoch=bound legacy_migrations=${m.legacyCount} postcutover_provenance=clean postcutover_migrations=${m.migrationCount}`);
NODE
