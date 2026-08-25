#!/usr/bin/env bash
set -euo pipefail

# Shared noel-core database migration authority moved to optical-lift/noel-core-db
# after the exact production fence below. Atlas keeps its pre-fence migration
# files as historical provenance, but it must not create a second post-fence
# executable migration ledger.
fence_version="20260825203448"
authority_repo="optical-lift/noel-core-db"

if [ ! -d "supabase/migrations" ]; then
  echo "Missing supabase/migrations"
  exit 1
fi

bad=0
while IFS= read -r file; do
  base="$(basename "$file")"

  # Historical nonstandard filenames remain inherited provenance. Only
  # timestamped migration files participate in the post-fence authority check.
  if [[ ! "$base" =~ ^([0-9]{14})_.*\.sql$ ]]; then
    continue
  fi

  version="${BASH_REMATCH[1]}"
  if [[ "$version" > "$fence_version" ]]; then
    echo "Post-fence noel-core migration is not owned by farm-atlas: $file"
    echo "Move the database change to $authority_repo (owner prefix: atlas_) and keep Atlas here as the consuming application."
    bad=1
  fi
done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort)

if [ "$bad" -ne 0 ]; then
  exit 1
fi

echo "Shared database migration custody guard passed: farm-atlas contains no timestamped migration after $fence_version."
