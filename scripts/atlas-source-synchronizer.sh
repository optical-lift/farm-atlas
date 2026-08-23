#!/usr/bin/env bash
set -euo pipefail

# Canonical Atlas executable-source custody membrane.
#
# This synchronizer proves that repository source owns the deployed Atlas management
# architecture without treating the shared Supabase ledger, production operational
# state, old PRs, or the separate Intelligence Network as interchangeable authorities.
#
# It is read-only against production. It does not deploy, mutate operational state,
# close PRs, or rewrite migration timestamps.

repo_root="$(git rev-parse --show-toplevel)"
engine="$repo_root/scripts/reconcile-production-migration-history.sh"
adjudications="$repo_root/docs/architecture/atlas-source-custody-adjudications.tsv"

: "${ATLAS_PRODUCTION_DATABASE_URL:?Set ATLAS_PRODUCTION_DATABASE_URL to a read-capable production PostgreSQL URL}"

"$engine" \
  --check \
  --since 0 \
  --scope atlas-management \
  --adjudications "$adjudications"

# The migration ledger proves deployment provenance. The current registry drift
# function separately proves that the governed authenticated Atlas RPC surface has
# not diverged from its repository-owned privilege contract.
rpc_drift="$({
  psql "$ATLAS_PRODUCTION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
    "select count(*) from atlas.authenticated_rpc_registry_drift_v1();"
} 2>/dev/null)"

if [[ ! "$rpc_drift" =~ ^[0-9]+$ ]]; then
  echo "SOURCE_SYNC_INVALID: could not obtain Atlas RPC drift count" >&2
  exit 2
fi
if ((rpc_drift > 0)); then
  echo "SOURCE_SYNC_RPC_DRIFT unresolved=$rpc_drift" >&2
  exit 1
fi

echo "ATLAS_SOURCE_SYNC_OK migration_custody=clean rpc_drift=0"
