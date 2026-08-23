#!/usr/bin/env bash
set -euo pipefail

# Reconcile repository migration history with the history Supabase says is already
# applied in production. This script is intentionally source-control only: it never
# executes a migration against production.
#
# Requirements:
#   ATLAS_PRODUCTION_DATABASE_URL  PostgreSQL connection string with read access to
#                                  supabase_migrations.schema_migrations
#   psql, git, node
#
# Modes:
#   --check    (default) fail on any missing, byte-mismatched, or version-drifted
#              production migration file
#   --restore  write truly missing files from production-recorded statement bytes,
#              then verify their Git blob SHA. Existing mismatches still require
#              explicit replacement opt-in. Same-name/version-drift candidates are
#              REPORT-ONLY in this mode and are never auto-renamed or deleted.
#   --replace-mismatched may be combined with --restore only when an existing local
#              historical file is known to be wrong and must be replaced by the
#              exact production-recorded bytes.
#
# Optional bounds:
#   --since VERSION   default 20260815225715 (first known Atlas history-repair gap)
#   --before VERSION  exclusive upper bound; omitted means no upper bound
#
# Version-drift classes:
#   VERSION_DRIFT_MATCH       exact production path is absent, but exactly one local
#                             file with the same migration name has identical bytes
#   VERSION_DRIFT_MISMATCH    same as above, but the bytes differ
#   AMBIGUOUS_NAME_DRIFT      more than one local alternate-version file shares the
#                             production migration name
#
# These drift states are deliberately not auto-fixed. A different migration version
# can change ordering and replay semantics even when SQL bytes match. Source custody
# therefore reports the condition so a human can normalize it intentionally.

mode="check"
replace_mismatched="false"
since_version="${ATLAS_MIGRATION_AUDIT_SINCE:-20260815225715}"
before_version="${ATLAS_MIGRATION_AUDIT_BEFORE:-}"

while (($#)); do
  case "$1" in
    --check)
      mode="check"
      ;;
    --restore)
      mode="restore"
      ;;
    --replace-mismatched)
      replace_mismatched="true"
      ;;
    --since)
      shift
      since_version="${1:-}"
      ;;
    --before)
      shift
      before_version="${1:-}"
      ;;
    -h|--help)
      sed -n '3,42p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$replace_mismatched" == "true" && "$mode" != "restore" ]]; then
  echo "--replace-mismatched requires --restore" >&2
  exit 2
fi

if [[ ! "$since_version" =~ ^[0-9]+$ ]]; then
  echo "--since must be a numeric Supabase migration version" >&2
  exit 2
fi
if [[ -n "$before_version" && ! "$before_version" =~ ^[0-9]+$ ]]; then
  echo "--before must be a numeric Supabase migration version" >&2
  exit 2
fi

: "${ATLAS_PRODUCTION_DATABASE_URL:?Set ATLAS_PRODUCTION_DATABASE_URL to a read-capable production PostgreSQL URL}"

for command_name in psql git node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 2
  fi
done

repo_root="$(git rev-parse --show-toplevel)"
migrations_dir="$repo_root/supabase/migrations"
mkdir -p "$migrations_dir"

manifest_file="$(mktemp)"
trap 'rm -f "$manifest_file" "${restore_tmp:-}"' EXIT

bounds_sql="version >= '$since_version'"
if [[ -n "$before_version" ]]; then
  bounds_sql+=" and version < '$before_version'"
fi

# Compute the SHA Git itself assigns to the exact statement bytes recorded by
# Supabase: SHA1("blob " + byte_length + NUL + bytes).
psql "$ATLAS_PRODUCTION_DATABASE_URL" \
  -X -v ON_ERROR_STOP=1 -At -F $'\t' \
  -c "
with migration_bytes as (
  select
    version,
    name,
    array_to_string(statements, E'\\n') as sql
  from supabase_migrations.schema_migrations
  where $bounds_sql
)
select
  version,
  name,
  encode(
    digest(
      convert_to('blob ' || octet_length(sql)::text, 'UTF8')
      || decode('00','hex')
      || convert_to(sql,'UTF8'),
      'sha1'
    ),
    'hex'
  ) as expected_blob_sha
from migration_bytes
order by version;
" > "$manifest_file"

checked=0
verified=0
restored=0
missing=0
mismatched=0
invalid=0
version_drift_match=0
version_drift_mismatch=0
ambiguous_name_drift=0

restore_exact_bytes() {
  local version="$1"
  local expected_sha="$2"
  local destination="$3"
  local encoded

  # Base64 gives psql a single textual value whose row terminator cannot mutate the
  # migration body. Node strips whitespace in PostgreSQL's wrapped base64 and emits
  # the original bytes without adding a newline.
  encoded="$(
    psql "$ATLAS_PRODUCTION_DATABASE_URL" \
      -X -v ON_ERROR_STOP=1 -At \
      -v target_version="$version" \
      -c "
select encode(
  convert_to(array_to_string(statements, E'\\n'),'UTF8'),
  'base64'
)
from supabase_migrations.schema_migrations
where version = :'target_version';
"
  )"

  if [[ -z "$encoded" ]]; then
    echo "ERROR $version: production statement body was empty or unavailable" >&2
    return 1
  fi

  restore_tmp="$(mktemp)"
  printf '%s' "$encoded" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => process.stdout.write(Buffer.from(input.replace(/\\s+/g, ""), "base64")));
' > "$restore_tmp"

  local restored_sha
  restored_sha="$(git hash-object "$restore_tmp")"
  if [[ "$restored_sha" != "$expected_sha" ]]; then
    echo "ERROR $version: restored bytes hash to $restored_sha, expected $expected_sha" >&2
    rm -f "$restore_tmp"
    restore_tmp=""
    return 1
  fi

  mv "$restore_tmp" "$destination"
  restore_tmp=""
}

report_version_drift_if_present() {
  local version="$1"
  local name="$2"
  local expected_sha="$3"
  local exact_path="$4"
  local candidates=()
  local candidate candidate_sha

  shopt -s nullglob
  candidates=("$migrations_dir"/*_"$name".sql)
  shopt -u nullglob

  # The exact path should be absent when this helper is called, but protect against
  # accidental inclusion so the classifier remains deterministic.
  local filtered=()
  for candidate in "${candidates[@]}"; do
    [[ "$candidate" == "$exact_path" ]] && continue
    filtered+=("$candidate")
  done
  candidates=("${filtered[@]}")

  if ((${#candidates[@]} == 0)); then
    return 1
  fi

  if ((${#candidates[@]} > 1)); then
    echo "AMBIGUOUS_NAME_DRIFT ${version}_${name}.sql expected=$expected_sha candidates=${#candidates[@]}" >&2
    for candidate in "${candidates[@]}"; do
      candidate_sha="$(git hash-object "$candidate")"
      echo "  candidate=$(basename "$candidate") sha=$candidate_sha" >&2
    done
    ((ambiguous_name_drift+=1))
    return 0
  fi

  candidate="${candidates[0]}"
  candidate_sha="$(git hash-object "$candidate")"
  if [[ "$candidate_sha" == "$expected_sha" ]]; then
    echo "VERSION_DRIFT_MATCH ${version}_${name}.sql source=$(basename "$candidate") sha=$candidate_sha"
    ((version_drift_match+=1))
  else
    echo "VERSION_DRIFT_MISMATCH ${version}_${name}.sql source=$(basename "$candidate") actual=$candidate_sha expected=$expected_sha" >&2
    ((version_drift_mismatch+=1))
  fi
  return 0
}

while IFS=$'\t' read -r version name expected_sha; do
  [[ -z "$version" ]] && continue
  ((checked+=1))

  if [[ ! "$version" =~ ^[0-9]+$ || ! "$name" =~ ^[A-Za-z0-9_]+$ || ! "$expected_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "INVALID production migration manifest row: version=$version name=$name sha=$expected_sha" >&2
    ((invalid+=1))
    continue
  fi

  path="$migrations_dir/${version}_${name}.sql"

  if [[ ! -f "$path" ]]; then
    # First distinguish true absence from the common historical case where the same
    # migration was checked in later under a different timestamp. This is report-only:
    # migration versions affect ordering and are never silently normalized.
    if report_version_drift_if_present "$version" "$name" "$expected_sha" "$path"; then
      continue
    fi

    if [[ "$mode" == "restore" ]]; then
      if restore_exact_bytes "$version" "$expected_sha" "$path"; then
        echo "RESTORED ${version}_${name}.sql $expected_sha"
        ((restored+=1))
        ((verified+=1))
      else
        ((missing+=1))
      fi
    else
      echo "MISSING  ${version}_${name}.sql expected=$expected_sha"
      ((missing+=1))
    fi
    continue
  fi

  actual_sha="$(git hash-object "$path")"
  if [[ "$actual_sha" == "$expected_sha" ]]; then
    ((verified+=1))
    continue
  fi

  if [[ "$mode" == "restore" && "$replace_mismatched" == "true" ]]; then
    if restore_exact_bytes "$version" "$expected_sha" "$path"; then
      echo "REPLACED ${version}_${name}.sql $actual_sha -> $expected_sha"
      ((restored+=1))
      ((verified+=1))
    else
      ((mismatched+=1))
    fi
  else
    echo "MISMATCH ${version}_${name}.sql actual=$actual_sha expected=$expected_sha" >&2
    ((mismatched+=1))
  fi
done < "$manifest_file"

echo "Migration history reconciliation: checked=$checked verified=$verified restored=$restored missing=$missing mismatched=$mismatched version_drift_match=$version_drift_match version_drift_mismatch=$version_drift_mismatch ambiguous_name_drift=$ambiguous_name_drift invalid=$invalid"

if ((missing > 0 || mismatched > 0 || version_drift_match > 0 || version_drift_mismatch > 0 || ambiguous_name_drift > 0 || invalid > 0)); then
  exit 1
fi
