#!/usr/bin/env bash
set -euo pipefail

# Canonical Atlas executable-source custody membrane.
#
# Primary proof: the repository-owned expected executable-surface contract must match
# the current live Atlas catalog fingerprint exactly.
# Secondary proof: the production migration ledger must have no unresolved provenance
# debt after governed version-drift adjudications are applied.
#
# This script is read-only against production.

repo_root="$(git rev-parse --show-toplevel)"
engine="$repo_root/scripts/reconcile-production-migration-history.sh"
expected_surface="$repo_root/docs/architecture/atlas-source-custody-surface-v1.json"
comparator="$repo_root/scripts/compare-atlas-source-custody-surface.mjs"

: "${ATLAS_PRODUCTION_DATABASE_URL:?Set ATLAS_PRODUCTION_DATABASE_URL to a read-capable production PostgreSQL URL}"

for required in psql git node; do
  command -v "$required" >/dev/null 2>&1 || { echo "SOURCE_SYNC_INVALID missing_command=$required" >&2; exit 2; }
done

observed_surface="$(mktemp)"
adjudications="$(mktemp)"
trap 'rm -f "$observed_surface" "$adjudications"' EXIT

# Current-state equivalence is the release verdict. The packet is derived directly
# from pg_catalog by a service-only function; registry rows cannot hide manual drift.
psql "$ATLAS_PRODUCTION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c "
with rows as (
  select * from atlas.source_custody_live_surface_v1()
), families as (
  select
    family_key,
    count(*) as artifact_count,
    encode(
      extensions.digest(
        convert_to(string_agg(artifact_key || E'\\t' || fingerprint_sha256, E'\\n' order by artifact_key), 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as family_fingerprint
  from rows
  group by family_key
)
select jsonb_build_object(
  'contractVersion', 1,
  'families', coalesce(jsonb_agg(jsonb_build_object(
    'familyKey', family_key,
    'artifactCount', artifact_count,
    'fingerprintSha256', family_fingerprint
  ) order by family_key), '[]'::jsonb)
)
from families;
" > "$observed_surface"

node "$comparator" "$expected_surface" "$observed_surface"

rpc_drift="$(psql "$ATLAS_PRODUCTION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
  "select count(*) from atlas.authenticated_rpc_registry_drift_v1();")"
if [[ ! "$rpc_drift" =~ ^[0-9]+$ ]]; then
  echo "SOURCE_SYNC_INVALID could_not_read_rpc_drift" >&2
  exit 2
fi
if ((rpc_drift > 0)); then
  echo "SOURCE_SYNC_RPC_DRIFT unresolved=$rpc_drift" >&2
  exit 1
fi

# Export governed accepted version-drift decisions into the low-level reconciler's
# interchange format. The database registry is authority; this temp file is not.
printf 'production_version\tproduction_name\trepository_file\tproduction_sha\trepository_sha\tdisposition\tevidence\n' > "$adjudications"
psql "$ATLAS_PRODUCTION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F $'\t' -c "
with latest as (
  select distinct on (custody_key)
    custody_key, disposition, evidence
  from atlas.source_custody_adjudications
  where custody_class = 'version_drift'
  order by custody_key, adjudicated_at desc
)
select
  evidence->>'productionVersion',
  evidence->>'productionName',
  evidence->>'repositoryFile',
  coalesce(evidence->>'productionSha',''),
  coalesce(evidence->>'repositorySha',''),
  'accepted',
  custody_key
from latest
where disposition = 'accepted'
  and evidence ? 'productionVersion'
  and evidence ? 'productionName'
  and evidence ? 'repositoryFile';
" >> "$adjudications"

"$engine" \
  --check \
  --since 0 \
  --scope atlas-management \
  --adjudications "$adjudications"

echo "ATLAS_SOURCE_SYNC_OK surface=exact rpc_drift=0 migration_provenance=clean"
