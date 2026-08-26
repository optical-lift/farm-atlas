#!/usr/bin/env bash
set -euo pipefail

# After the shared noel-core database cutover, farm-atlas is a consuming
# application repository. Canonical post-fence database migrations belong to
# optical-lift/noel-core-db. This verifier keeps the application release gate
# strong without pretending the frozen farm-atlas surface snapshot is still the
# current database authority.

fence_version="20260825203448"
authority_repo="optical-lift/noel-core-db"
authority_ref="main"
authority_raw_base="https://raw.githubusercontent.com/${authority_repo}/${authority_ref}"
expected_project_ref="zirqkouammpwxlqfbsvf"

: "${ATLAS_SOURCE_CUSTODY_API_URL:?ATLAS_SOURCE_CUSTODY_API_URL is required}"
: "${ATLAS_SUPABASE_PUBLISHABLE_KEY:?ATLAS_SUPABASE_PUBLISHABLE_KEY is required}"

for required in curl git python3; do
  command -v "$required" >/dev/null 2>&1 || {
    echo "SHARED_DB_ATLAS_CUSTODY_INVALID missing_command=$required" >&2
    exit 2
  }
done

baseline="$(mktemp)"
shared_packet="$(mktemp)"
atlas_packet="$(mktemp)"
manifest="$(mktemp)"
trap 'rm -f "$baseline" "$shared_packet" "$atlas_packet" "$manifest"' EXIT

curl --fail --silent --show-error --location \
  "${authority_raw_base}/custody/production-baseline-v1.json" \
  > "$baseline"

shared_url="${ATLAS_SOURCE_CUSTODY_API_URL%/source_custody_release_packet_v1}/shared_db_custody_release_packet_v1"

curl --fail --silent --show-error \
  --request POST \
  --header "apikey: ${ATLAS_SUPABASE_PUBLISHABLE_KEY}" \
  --header "Authorization: Bearer ${ATLAS_SUPABASE_PUBLISHABLE_KEY}" \
  --header "Content-Type: application/json" \
  --data '{}' \
  "$shared_url" \
  > "$shared_packet"

curl --fail --silent --show-error \
  --request POST \
  --header "apikey: ${ATLAS_SUPABASE_PUBLISHABLE_KEY}" \
  --header "Content-Type: application/json" \
  --header "Accept-Profile: atlas" \
  --header "Content-Profile: atlas" \
  --data '{}' \
  "$ATLAS_SOURCE_CUSTODY_API_URL" \
  > "$atlas_packet"

python3 - "$baseline" "$shared_packet" "$atlas_packet" "$manifest" "$fence_version" "$authority_repo" "$expected_project_ref" <<'PY'
import json
import sys
from pathlib import Path

baseline_path, shared_path, atlas_path, manifest_path, fence_version, authority_repo, expected_project_ref = sys.argv[1:]


def load(path, label):
    try:
        return json.loads(Path(path).read_text())
    except Exception as exc:
        print(f"SHARED_DB_ATLAS_CUSTODY_INVALID {label}_json={exc}", file=sys.stderr)
        raise SystemExit(2)


def fail(message):
    print(f"SHARED_DB_ATLAS_CUSTODY_INVALID {message}", file=sys.stderr)
    raise SystemExit(2)


baseline = load(baseline_path, "baseline")
shared = load(shared_path, "shared_packet")
atlas = load(atlas_path, "atlas_packet")
if isinstance(atlas, list) and len(atlas) == 1:
    atlas = atlas[0]

cutover = baseline.get("cutover") or {}
anchor = baseline.get("atlasAnchor") or {}
inherited = baseline.get("inheritedHistory") or {}
physical = baseline.get("physicalProject") or {}

if baseline.get("contractVersion") != 1:
    fail("baseline_contract_version")
if physical.get("projectRef") != expected_project_ref:
    fail(f"baseline_project_ref={physical.get('projectRef')!r}")
if cutover.get("effectiveAfterVersion") != fence_version:
    fail(f"baseline_fence={cutover.get('effectiveAfterVersion')!r}")
if cutover.get("newExecutableMigrationAuthority") != authority_repo:
    fail(f"baseline_authority={cutover.get('newExecutableMigrationAuthority')!r}")
if cutover.get("productRepositoriesMayOwnNewCanonicalMigrations") is not False:
    fail("product_repository_migration_authority_not_disabled")
if anchor.get("repository") != "optical-lift/farm-atlas":
    fail(f"atlas_anchor_repository={anchor.get('repository')!r}")

# The local farm-atlas surface file is now a frozen handoff anchor only. It must
# remain byte-semantically equivalent to the anchor recorded by noel-core-db.
local_surface = load("docs/architecture/atlas-source-custody-surface-v1.json", "local_surface")
local_families = local_surface.get("families") or []
anchor_families = anchor.get("families") or []
if local_families != anchor_families:
    fail("farm_atlas_frozen_surface_anchor_differs_from_noel_core_db")
if sum(int(row.get("artifactCount", 0)) for row in local_families) != int(anchor.get("governedArtifactCount", -1)):
    fail("farm_atlas_frozen_surface_count_differs_from_noel_core_db")

if shared.get("contractVersion") != 1:
    fail(f"shared_packet_contract={shared.get('contractVersion')!r}")
if shared.get("projectRef") != expected_project_ref:
    fail(f"shared_packet_project={shared.get('projectRef')!r}")

shared_fence = shared.get("fence") or {}
for key, expected in {
    "migrationCount": inherited.get("migrationCount"),
    "firstVersion": inherited.get("firstVersion"),
    "throughVersion": inherited.get("throughVersion"),
    "ledgerSha256": inherited.get("ledgerSha256"),
}.items():
    if shared_fence.get(key) != expected:
        fail(f"shared_fence_{key}={shared_fence.get(key)!r}_expected={expected!r}")

if not isinstance(atlas, dict) or atlas.get("contractVersion") != 2:
    fail("atlas_release_packet_contract")
if int(atlas.get("rpcDriftCount", -1)) != 0:
    fail(f"atlas_rpc_drift={atlas.get('rpcDriftCount')!r}")

provenance = atlas.get("migrationProvenance") or {}
atlas_manifest = provenance.get("manifest") or []
if not isinstance(atlas_manifest, list):
    fail("atlas_migration_manifest_missing")

shared_post = shared.get("postFence") or []
shared_by_version = {str(row.get("version") or ""): row for row in shared_post}
rows = []
for row in atlas_manifest:
    version = str(row.get("version") or "")
    if version <= fence_version:
        continue
    name = str(row.get("name") or "")
    blob = str(row.get("expectedBlobSha") or "")
    if not version.isdigit() or len(version) != 14:
        fail(f"atlas_post_fence_version={version!r}")
    if not name or not blob or len(blob) != 40:
        fail(f"atlas_post_fence_manifest_row={row!r}")
    shared_row = shared_by_version.get(version)
    if not shared_row:
        fail(f"atlas_migration_missing_from_shared_ledger={version}_{name}")
    if str(shared_row.get("name") or "") != name:
        fail(f"atlas_shared_name_mismatch={version}_{name}")
    if str(shared_row.get("gitBlobSha1") or "") != blob:
        fail(f"atlas_shared_blob_mismatch={version}_{name}")
    rows.append((version, name, blob))

if not rows:
    fail("no_post_shared_fence_atlas_migrations_found")
if [version for version, _, _ in rows] != sorted(version for version, _, _ in rows):
    fail("post_shared_fence_atlas_versions_not_sorted")
if len({version for version, _, _ in rows}) != len(rows):
    fail("duplicate_post_shared_fence_atlas_version")

Path(manifest_path).write_text("".join(f"{version}\t{name}\t{blob}\n" for version, name, blob in rows))

surface = atlas.get("surface") or {}
families = surface.get("families") or []
live_count = sum(int(row.get("artifactCount", 0)) for row in families)
print(
    "SHARED_DB_ATLAS_CUSTODY_PACKET_OK "
    f"authority={authority_repo} frozen_anchor={anchor.get('mainSha')} "
    f"post_fence_atlas_migrations={len(rows)} live_artifacts={live_count} rpc_drift=0"
)
PY

while IFS=$'\t' read -r version name expected_blob; do
  [ -n "$version" ] || continue
  migration_file="$(mktemp)"
  migration_url="${authority_raw_base}/supabase/migrations/${version}_${name}.sql"
  if ! curl --fail --silent --show-error --location "$migration_url" > "$migration_file"; then
    rm -f "$migration_file"
    echo "SHARED_DB_ATLAS_CUSTODY_INVALID canonical_source_missing=${version}_${name}" >&2
    exit 1
  fi
  actual_blob="$(git hash-object "$migration_file")"
  rm -f "$migration_file"
  if [ "$actual_blob" != "$expected_blob" ]; then
    echo "SHARED_DB_ATLAS_CUSTODY_INVALID canonical_blob_mismatch=${version}_${name} expected=${expected_blob} actual=${actual_blob}" >&2
    exit 1
  fi
done < "$manifest"

echo "SHARED_DB_ATLAS_CUSTODY_OK authority=${authority_repo}@${authority_ref} post_fence_atlas_source=exact rpc_drift=0"
