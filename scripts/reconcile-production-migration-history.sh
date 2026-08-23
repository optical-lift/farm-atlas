#!/usr/bin/env bash
set -euo pipefail

# Low-level custody engine used by the Atlas Source Synchronizer.
# It compares repository migration bytes with the immutable Supabase deployment ledger.
# It never executes migrations against production.
#
# Requirements:
#   ATLAS_PRODUCTION_DATABASE_URL  read access to supabase_migrations.schema_migrations
#   psql, git, node
#
# Modes:
#   --check    (default) classify and verify source custody
#   --restore  restore truly missing exact production bytes into repository source
#   --replace-mismatched  with --restore only; replace a known wrong exact-version file
#
# Scope:
#   --scope all               inspect every production migration in the version window
#   --scope atlas-management  inspect migrations whose deployed SQL touches atlas.*
#
# Bounds:
#   --since VERSION   default 20260815225715
#   --before VERSION  exclusive upper bound
#
# Adjudications:
#   --adjudications FILE  TSV file for deliberate VERSION_DRIFT_ALIAS decisions.
#                         A drift alias is accepted only when its repository blob is
#                         byte-identical to the production ledger blob. MISSING,
#                         MISMATCH, VERSION_DRIFT_MISMATCH and AMBIGUOUS_NAME_DRIFT
#                         are never suppressible.

mode="check"
replace_mismatched="false"
since_version="${ATLAS_MIGRATION_AUDIT_SINCE:-20260815225715}"
before_version="${ATLAS_MIGRATION_AUDIT_BEFORE:-}"
scope="${ATLAS_MIGRATION_AUDIT_SCOPE:-all}"
adjudications_file="${ATLAS_MIGRATION_CUSTODY_ADJUDICATIONS:-}"

while (($#)); do
  case "$1" in
    --check) mode="check" ;;
    --restore) mode="restore" ;;
    --replace-mismatched) replace_mismatched="true" ;;
    --since) shift; since_version="${1:-}" ;;
    --before) shift; before_version="${1:-}" ;;
    --scope) shift; scope="${1:-}" ;;
    --adjudications) shift; adjudications_file="${1:-}" ;;
    -h|--help) sed -n '3,34p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
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
if [[ "$scope" != "all" && "$scope" != "atlas-management" ]]; then
  echo "--scope must be all or atlas-management" >&2
  exit 2
fi

: "${ATLAS_PRODUCTION_DATABASE_URL:?Set ATLAS_PRODUCTION_DATABASE_URL to a read-capable production PostgreSQL URL}"
for command_name in psql git node; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Required command not found: $command_name" >&2; exit 2; }
done

repo_root="$(git rev-parse --show-toplevel)"
migrations_dir="$repo_root/supabase/migrations"
mkdir -p "$migrations_dir"

if [[ -z "$adjudications_file" ]]; then
  adjudications_file="$repo_root/docs/architecture/atlas-source-custody-adjudications.tsv"
elif [[ "$adjudications_file" != /* ]]; then
  adjudications_file="$repo_root/$adjudications_file"
fi

manifest_file="$(mktemp)"
trap 'rm -f "$manifest_file" "${restore_tmp:-}"' EXIT

bounds_sql="version >= '$since_version'"
[[ -n "$before_version" ]] && bounds_sql+=" and version < '$before_version'"
scope_sql="true"
if [[ "$scope" == "atlas-management" ]]; then
  # The shared Supabase project also carries Noel / Intelligence Network history.
  # Atlas custody is intentionally limited to deployed migrations whose SQL actually
  # touches the atlas schema. Cross-product seams that mutate atlas.* are therefore
  # included, while research-only migrations do not become Atlas release blockers.
  scope_sql="position('atlas.' in lower(sql)) > 0"
fi

psql "$ATLAS_PRODUCTION_DATABASE_URL" \
  -X -v ON_ERROR_STOP=1 -At -F $'\t' \
  -c "
with migration_bytes as (
  select version, name, array_to_string(statements, E'\\n') as sql
  from supabase_migrations.schema_migrations
  where $bounds_sql
), scoped as (
  select * from migration_bytes where $scope_sql
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
from scoped
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
adjudicated_drift=0

restore_exact_bytes() {
  local version="$1" expected_sha="$2" destination="$3" encoded
  encoded="$(
    psql "$ATLAS_PRODUCTION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At \
      -v target_version="$version" \
      -c "select encode(convert_to(array_to_string(statements, E'\\n'),'UTF8'),'base64') from supabase_migrations.schema_migrations where version = :'target_version';"
  )"
  if [[ -z "$encoded" ]]; then
    echo "ERROR $version: production statement body was empty or unavailable" >&2
    return 1
  fi
  restore_tmp="$(mktemp)"
  printf '%s' "$encoded" | node -e '
let input=""; process.stdin.setEncoding("utf8");
process.stdin.on("data",c=>input+=c);
process.stdin.on("end",()=>process.stdout.write(Buffer.from(input.replace(/\s+/g,""),"base64")));
' > "$restore_tmp"
  local restored_sha
  restored_sha="$(git hash-object "$restore_tmp")"
  if [[ "$restored_sha" != "$expected_sha" ]]; then
    echo "ERROR $version: restored bytes hash to $restored_sha, expected $expected_sha" >&2
    rm -f "$restore_tmp"; restore_tmp=""
    return 1
  fi
  mv "$restore_tmp" "$destination"; restore_tmp=""
}

lookup_drift_adjudication() {
  local version="$1" name="$2" candidate_rel="$3"
  [[ -f "$adjudications_file" ]] || return 1
  awk -F '\t' -v v="$version" -v n="$name" -v c="$candidate_rel" '
    $0 !~ /^#/ && NF >= 4 && $1==v && $2==n && $3=="VERSION_DRIFT_ALIAS" && $4==c { found=1 }
    END { exit(found ? 0 : 1) }
  ' "$adjudications_file"
}

report_version_drift_if_present() {
  local version="$1" name="$2" expected_sha="$3" exact_path="$4"
  local candidates=() candidate candidate_sha candidate_rel
  shopt -s nullglob
  candidates=("$migrations_dir"/*_"$name".sql)
  shopt -u nullglob
  local filtered=()
  for candidate in "${candidates[@]}"; do
    [[ "$candidate" == "$exact_path" ]] && continue
    filtered+=("$candidate")
  done
  candidates=("${filtered[@]}")
  ((${#candidates[@]} > 0)) || return 1

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
  candidate_rel="${candidate#$repo_root/}"
  if [[ "$candidate_sha" != "$expected_sha" ]]; then
    echo "VERSION_DRIFT_MISMATCH ${version}_${name}.sql source=$(basename "$candidate") actual=$candidate_sha expected=$expected_sha" >&2
    ((version_drift_mismatch+=1))
    return 0
  fi

  if lookup_drift_adjudication "$version" "$name" "$candidate_rel"; then
    echo "ADJUDICATED_VERSION_DRIFT ${version}_${name}.sql source=$candidate_rel sha=$candidate_sha"
    ((adjudicated_drift+=1))
    ((verified+=1))
  else
    echo "VERSION_DRIFT_MATCH ${version}_${name}.sql source=$candidate_rel sha=$candidate_sha" >&2
    ((version_drift_match+=1))
  fi
  return 0
}

while IFS=$'\t' read -r version name expected_sha; do
  [[ -z "$version" ]] && continue
  ((checked+=1))
  if [[ ! "$version" =~ ^[0-9]+$ || ! "$name" =~ ^[A-Za-z0-9_]+$ || ! "$expected_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "INVALID production migration manifest row: version=$version name=$name sha=$expected_sha" >&2
    ((invalid+=1)); continue
  fi

  path="$migrations_dir/${version}_${name}.sql"
  if [[ ! -f "$path" ]]; then
    if report_version_drift_if_present "$version" "$name" "$expected_sha" "$path"; then
      continue
    fi
    if [[ "$mode" == "restore" ]]; then
      if restore_exact_bytes "$version" "$expected_sha" "$path"; then
        echo "RESTORED ${version}_${name}.sql $expected_sha"
        ((restored+=1)); ((verified+=1))
      else
        ((missing+=1))
      fi
    else
      echo "MISSING ${version}_${name}.sql expected=$expected_sha" >&2
      ((missing+=1))
    fi
    continue
  fi

  actual_sha="$(git hash-object "$path")"
  if [[ "$actual_sha" == "$expected_sha" ]]; then
    ((verified+=1)); continue
  fi

  if [[ "$mode" == "restore" && "$replace_mismatched" == "true" ]]; then
    if restore_exact_bytes "$version" "$expected_sha" "$path"; then
      echo "REPLACED ${version}_${name}.sql $actual_sha -> $expected_sha"
      ((restored+=1)); ((verified+=1))
    else
      ((mismatched+=1))
    fi
  else
    echo "MISMATCH ${version}_${name}.sql actual=$actual_sha expected=$expected_sha" >&2
    ((mismatched+=1))
  fi
done < "$manifest_file"

echo "Migration custody: scope=$scope checked=$checked verified=$verified restored=$restored adjudicated_drift=$adjudicated_drift missing=$missing mismatched=$mismatched version_drift_match=$version_drift_match version_drift_mismatch=$version_drift_mismatch ambiguous_name_drift=$ambiguous_name_drift invalid=$invalid"

if ((missing > 0 || mismatched > 0 || version_drift_match > 0 || version_drift_mismatch > 0 || ambiguous_name_drift > 0 || invalid > 0)); then
  exit 1
fi
