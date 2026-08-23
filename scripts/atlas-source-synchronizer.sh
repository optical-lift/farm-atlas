#!/usr/bin/env bash
set -euo pipefail

# Canonical Atlas executable-source custody membrane.
#
# Primary proof: the repository-owned expected executable-surface contract must match
# the current live Atlas catalog fingerprint exactly.
# Secondary proof: the production migration ledger must have no unresolved provenance
# debt after governed version-drift adjudications are applied.
#
# The preferred path consumes a narrow read-only source-custody packet through the
# Supabase API and needs no raw PostgreSQL credential. Direct database access remains
# available for owner/admin recovery work.

repo_root="$(git rev-parse --show-toplevel)"
engine="$repo_root/scripts/reconcile-production-migration-history.sh"
expected_surface="$repo_root/docs/architecture/atlas-source-custody-surface-v1.json"
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

node - "$packet" "$observed_surface" "$manifest" "$adjudications" "$metadata" <<'NODE'
const fs = require('node:fs');
const [packetPath, surfacePath, manifestPath, adjudicationsPath, metadataPath] = process.argv.slice(2);
let packet;
try {
  packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
} catch (error) {
  console.error(`SOURCE_SYNC_INVALID invalid_packet_json=${error.message}`);
  process.exit(2);
}
if (Array.isArray(packet) && packet.length === 1) packet = packet[0];
if (!packet || packet.contractVersion !== 1 || !packet.surface || !packet.migrationProvenance) {
  console.error('SOURCE_SYNC_INVALID malformed_release_packet');
  process.exit(2);
}
if (packet.migrationProvenance.scope !== 'atlas-management') {
  console.error(`SOURCE_SYNC_INVALID unexpected_scope=${packet.migrationProvenance.scope}`);
  process.exit(2);
}
if (!Array.isArray(packet.surface.families) || !Array.isArray(packet.migrationProvenance.manifest)) {
  console.error('SOURCE_SYNC_INVALID packet_arrays_missing');
  process.exit(2);
}
const safeField = (value, pattern, label) => {
  const text = String(value ?? '');
  if (!pattern.test(text)) {
    console.error(`SOURCE_SYNC_INVALID ${label}=${JSON.stringify(text)}`);
    process.exit(2);
  }
  return text;
};
fs.writeFileSync(surfacePath, JSON.stringify({
  contractVersion: packet.surface.contractVersion,
  families: packet.surface.families,
}) + '\n');
const manifestLines = packet.migrationProvenance.manifest.map((row) => [
  safeField(row.version, /^\d+$/, 'migration_version'),
  safeField(row.name, /^[A-Za-z0-9_]+$/, 'migration_name'),
  safeField(row.expectedBlobSha, /^[0-9a-f]{40}$/, 'migration_blob_sha'),
].join('\t'));
fs.writeFileSync(manifestPath, manifestLines.join('\n') + (manifestLines.length ? '\n' : ''));
const adjudicationLines = ['# production_version\tproduction_name\tdisposition\trepository_file\tcustody_key'];
for (const row of packet.acceptedVersionDrift ?? []) {
  const evidence = row.evidence ?? {};
  const storedRepositoryFile = safeField(evidence.repositoryFile, /^(?:supabase\/migrations\/)?[A-Za-z0-9_.-]+\.sql$/, 'adjudication_repository_file');
  const repositoryFile = storedRepositoryFile.startsWith('supabase/migrations/')
    ? storedRepositoryFile
    : `supabase/migrations/${storedRepositoryFile}`;
  adjudicationLines.push([
    safeField(evidence.productionVersion, /^\d+$/, 'adjudication_production_version'),
    safeField(evidence.productionName, /^[A-Za-z0-9_]+$/, 'adjudication_production_name'),
    'VERSION_DRIFT_ALIAS',
    repositoryFile,
    safeField(row.custodyKey, /^[A-Za-z0-9_.:\/-]+$/, 'adjudication_custody_key'),
  ].join('\t'));
}
fs.writeFileSync(adjudicationsPath, adjudicationLines.join('\n') + '\n');
const rpcDrift = Number(packet.rpcDriftCount);
const migrationCount = Number(packet.migrationProvenance.migrationCount);
if (!Number.isInteger(rpcDrift) || rpcDrift < 0 || !Number.isInteger(migrationCount) || migrationCount < 0) {
  console.error('SOURCE_SYNC_INVALID invalid_packet_counts');
  process.exit(2);
}
if (migrationCount !== manifestLines.length) {
  console.error(`SOURCE_SYNC_INVALID manifest_count=${manifestLines.length} declared=${migrationCount}`);
  process.exit(2);
}
fs.writeFileSync(metadataPath, JSON.stringify({ rpcDrift, migrationCount }) + '\n');
NODE

node "$comparator" "$expected_surface" "$observed_surface"

rpc_drift="$(node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(m.rpcDrift));' "$metadata")"
if ((rpc_drift > 0)); then
  echo "SOURCE_SYNC_RPC_DRIFT unresolved=$rpc_drift" >&2
  exit 1
fi

"$engine" \
  --check \
  --since 0 \
  --scope atlas-management \
  --manifest "$manifest" \
  --adjudications "$adjudications"

migration_count="$(node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(m.migrationCount));' "$metadata")"
echo "ATLAS_SOURCE_SYNC_OK surface=exact rpc_drift=0 migration_provenance=clean migrations=$migration_count"
