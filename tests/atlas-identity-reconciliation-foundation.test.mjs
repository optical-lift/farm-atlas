import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("#788 uses evidence-first identity subjects rather than a canonical Party directory", () => {
  assert.equal(
    existsSync(join(root, "docs/architecture/atlas-core-party-model-v1.md")),
    false,
  );

  const contract = read("docs/architecture/atlas-core-identity-reconciliation-v1.md");
  assert.match(contract, /identity \*\*evidence-first\*\*/i);
  assert.match(contract, /thin Core subject/i);
  assert.match(contract, /Party, Person, Organization, and Place become projections/i);
  assert.match(contract, /explicit non-match/i);
  assert.match(contract, /split \/ mistaken merge/i);
  assert.doesNotMatch(contract, /Atlas owns canonical Party IDs/i);
});

test("farm-atlas is a consumer of the #788 database surface, not post-fence migration authority", () => {
  const custody = read(
    "docs/architecture/atlas-core-identity-reconciliation-db-custody-v1.md",
  );
  const guard = read("scripts/check-shared-db-migration-custody.sh");

  assert.match(custody, /Database authority:\*\* `optical-lift\/noel-core-db`/i);
  assert.match(custody, /does \*\*not\*\* own executable post-fence migrations/i);
  assert.match(custody, /production release and migration validation remain the responsibility of `noel-core-db`/i);
  assert.match(guard, /authority_repo="optical-lift\/noel-core-db"/i);

  assert.equal(
    existsSync(
      join(
        root,
        "supabase/migrations/20260904202000_atlas_core_identity_reconciliation_foundation_v1.sql",
      ),
    ),
    false,
  );
  assert.equal(
    existsSync(
      join(
        root,
        "supabase/migrations/20260904204000_atlas_core_identity_reconciliation_contracts_v1.sql",
      ),
    ),
    false,
  );
});

test("the database custody contract preserves evidence-first identity semantics", () => {
  const custody = read(
    "docs/architecture/atlas-core-identity-reconciliation-db-custody-v1.md",
  );

  for (const relation of [
    "atlas.identity_subjects",
    "atlas.identity_source_records",
    "atlas.identity_claims",
    "atlas.identity_source_subject_assertions",
    "atlas.identity_subject_pair_assertions",
    "atlas.identity_reconciliation_reviews",
    "atlas.identity_reconciliation_adjudications",
    "atlas.identity_subject_projections",
    "atlas.v_identity_parties_v1",
  ]) {
    assert.match(custody, new RegExp(relation.replaceAll(".", "\\.")));
  }

  assert.match(custody, /thin tenant-scoped subject UUID/i);
  assert.match(custody, /Source\/provider\/legacy rows remain evidence/i);
  assert.match(custody, /Explicit non-match/i);
  assert.match(custody, /Mistaken identity reconciliation can be corrected/i);
  assert.match(custody, /Same.*,.*Different.*,.*Not enough evidence/is);
  assert.match(custody, /Insufficient evidence remains unresolved/i);
  assert.match(custody, /Party.*Person.*Organization.*Place.*projections/is);
});

test("Smart Contacts remains provider evidence rather than Atlas identity authority", () => {
  const boundary = read("docs/architecture/smart-contacts-elm-local-boundary-v1.md");
  const custody = read(
    "docs/architecture/atlas-core-identity-reconciliation-db-custody-v1.md",
  );

  assert.match(boundary, /provider-owned source records/i);
  assert.match(boundary, /identity subjects/i);
  assert.match(boundary, /Similarity is evidence, not proof/i);
  assert.match(boundary, /no new Atlas Core foreign keys target `local_intel`/i);
  assert.match(custody, /Smart Contacts \/ Elm Local may contribute provider evidence but may not own Atlas identity/i);
});

test("the app depends on governed identity read/review contracts rather than raw mutation", () => {
  const custody = read(
    "docs/architecture/atlas-core-identity-reconciliation-db-custody-v1.md",
  );

  assert.match(custody, /atlas\.identity_party_projection_v1\(uuid\)/i);
  assert.match(custody, /atlas\.identity_subject_provenance_v1\(uuid\)/i);
  assert.match(custody, /atlas\.identity_review_queue_v1\(uuid\)/i);
  assert.match(custody, /atlas\.identity_adjudicate_review_v1\(uuid,text,text\)/i);
  assert.match(custody, /may not directly mutate the identity evidence ledger/i);
});
