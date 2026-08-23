# Atlas Source Custody

**Status:** Governing repository contract for the Atlas Whole-System Finish Build v1

## Authority is split on purpose

Atlas management software is one operating system, but its authorities are not interchangeable:

1. **Repository `main` — executable source authority.** Application code, schema/rules, tests, contracts, and the expected executable-surface and provenance-policy contracts live here.
2. **Canonical production state — operational reality.** Crops, observations, decisions, resources, results, placements, and other live operating facts are production truth rather than source code.
3. **Supabase migration ledger — deployment provenance.** It proves what migration was actually applied, when, and with what deployed bytes.
4. **Source-custody registry — reconciliation memory.** It preserves append-only adjudication evidence and custody epochs. It does not own executable architecture and cannot override a live catalog mismatch.
5. **Atlas Whole-System Finish Build v1 — development-direction authority.** Specialist plans remain subordinate domain specifications.
6. **Old branches and pull requests — salvage/history only.** They may supply evidence but never remain a parallel source of architectural truth.
7. **Atlas/Noel Intelligence Network — separate product.** Research-only migrations are not Atlas release blockers merely because both products share a Supabase project.

No authority is allowed to impersonate another.

## Three-layer proof

Tranche 0A uses three independent custody layers.

### 1. Current-state equivalence — primary release proof

The repository owns `docs/architecture/atlas-source-custody-surface-v1.json`. It is the expected fingerprint contract for the current governed Atlas executable surface.

Production derives the observed surface directly from PostgreSQL catalogs through `atlas.source_custody_live_surface_v1()` and `atlas.source_custody_live_packet_v1()`. The narrow `atlas.source_custody_release_packet_v1()` exposes only the resulting fingerprints, RPC drift count, migration provenance hashes, and governed adjudication metadata so CI can prove custody without a raw production database credential. It exposes no operational business rows and no migration SQL bodies.

The governed surface covers five release-blocking families:

- Atlas function definitions, signatures, security-definer state, and function configuration;
- Atlas row-level-security policies;
- Atlas non-internal triggers;
- Atlas table constraints; and
- the active authenticated/anonymous/service RPC privilege contract.

Each artifact has a SHA-256 fingerprint. Each family fingerprint is SHA-256 over the ordered artifact identity + artifact hash sequence. Adding, removing, or changing any governed artifact changes the family contract.

The current contract covers **4,303 governed Atlas artifacts**: 2,131 constraints, 1,158 functions, 166 RLS policies, 468 RPC privilege records, and 380 triggers.

`scripts/compare-atlas-source-custody-surface.mjs` compares the repository-owned expected family contract with the live catalog-derived family contract. `SURFACE_MISMATCH`, `MISSING_LIVE_FAMILY`, and `UNEXPECTED_LIVE_FAMILY` are release failures.

The source-custody measurement functions themselves are excluded from function-family fingerprint recursion. Their callable privilege boundary remains visible through the RPC privilege family.

### 2. Source ownership and governed adjudication

Production contains `atlas.source_custody_surface_families` and append-only `atlas.source_custody_adjudications`. UPDATE and DELETE of adjudications are rejected by the database. An adjudication can explain provenance, supersession, or a custody epoch, but it cannot make a current executable-surface mismatch pass.

The known Grow Room timestamp divergence remains explicit historical evidence: production deployed `20260727181055_trail_foundation_grow_room_v1`; repository history merged the identical Git blob under `20260727193000_trail_foundation_grow_room_v1` in PR #81. Both blobs are `8fb94ffe8019f9829808a57d51b317614da90151`.

### 3. Deployment provenance — historical epoch plus exact-source future

A full live census found **1,171 Atlas-touching production migrations before the custody membrane**. Repository comparison classified that legacy epoch as 363 verified/accounted rows and 808 non-reproducible historical rows: 234 missing exact source files, 190 exact-version byte mismatches, 73 identical-byte timestamp drifts awaiting individual historical adjudication, 309 same-name version-drift mismatches, and 2 ambiguous name drifts.

Those facts are preserved rather than rewritten. The pre-custody ledger is bound to a repository-owned and append-only adjudicated epoch:

- custody key: `atlas-management-before-20260823202957`;
- cutover version: `20260823202957`;
- migration count: 1,171;
- first version: `20260702174405`;
- last version: `20260823163557`;
- ordered ledger manifest SHA-256: `68d1e72e8a85ac35dd892d08d2b491f435324acb26c6e0386639ef12377c0ed8`.

The repository policy is `docs/architecture/atlas-source-custody-provenance-v1.json`. The live release packet recomputes the legacy ledger fingerprint every run and returns the append-only adjudication. CI requires the live fingerprint, production adjudication, and repository policy to agree exactly. A historical ledger mutation therefore fails custody even though legacy source discrepancies are no longer treated as present executable-source authority.

This epoch does **not** call the 808 discrepancies fixed, verified, or harmless. It records them as immutable non-reproducible history while making the current executable surface the primary proof of what Atlas is now.

From migration version `20260823202957` forward, the rule changes permanently: every Atlas-management migration must reconcile to repository source exactly or through a specific governed per-artifact adjudication. `MISSING`, `MISMATCH`, `VERSION_DRIFT_MISMATCH`, `AMBIGUOUS_NAME_DRIFT`, and unadjudicated `VERSION_DRIFT_MATCH` are hard release failures in the post-cutover epoch.

Migration timestamps are never silently renamed because ordering is executable semantics.

## Canonical Source Synchronizer

The release membrane is `scripts/atlas-source-synchronizer.sh`, invoked by `npm run sync:atlas:source`.

Its order is deliberate:

1. obtain the current live Atlas catalog fingerprint through the narrow custody release packet;
2. require exact equivalence with the repository-owned expected surface contract;
3. require `atlas.authenticated_rpc_registry_drift_v1()` to report zero drift;
4. require the live pre-cutover ledger fingerprint to equal both the repository provenance policy and the append-only historical-provenance adjudication; and
5. require every post-cutover Atlas-management migration to reconcile with zero unresolved source-custody debt.

The synchronizer is read-only against production. The production schema used to support custody is installed through ordinary governed migrations; the synchronizer itself never deploys, repairs operational data, changes scheduling, or edits adjudications.

## Custody governance deployment

The custody registry is governance infrastructure, not an operational Atlas feature. It was intentionally installed in production so source/live equivalence can be measured independently of repository claims. The custody migrations themselves are inside the exact-source post-cutover epoch and therefore must pass the same provenance gate they enforce.

The production custody sequence is:

- `20260823202957_atlas_source_custody_surface_registry_v1`;
- `20260823203337_atlas_source_custody_seed_adjudications_v1`;
- `20260823204558_atlas_source_custody_release_packet_v1`;
- `20260823204641_atlas_source_custody_release_packet_registry_v1`;
- `20260823205508_atlas_source_custody_legacy_epoch_v1`.

These migrations add custody metadata/read surfaces only; they do not alter crops, tasks, scheduling, execution results, or other operational business state.

## Product boundary

The production project also contains Noel / Intelligence Network history. Atlas migration custody includes deployed SQL that actually touches `atlas.*`; research-only migrations do not become Atlas release blockers simply because they share the Supabase project. Cross-product seams that mutate Atlas remain visible.

## Hard rules

- A current live Atlas surface mismatch is never waived by historical provenance adjudication.
- The pre-cutover ledger fingerprint and debt census remain explicit institutional memory; they are not rewritten into fake reproducibility.
- Every Atlas-management migration at or after the custody cutover must have exact repository custody or a specific governed adjudication.
- The custody registry records the relationship among authorities; it never becomes executable source authority.
- A stale branch is never merged wholesale merely because production contains some of its ideas.
- Closing historical PRs is repository hygiene, not a source-custody release prerequisite once no unique executable authority remains outside `main`.
- Ordinary product changes do not belong inside custody repair unless required to restore source/live equivalence.

## Tranche 0A exit gate

Tranche 0A is complete when:

1. the repository-owned executable-surface contract exactly matches the catalog-derived live Atlas surface;
2. the governed Atlas RPC drift count is zero;
3. the pre-cutover historical ledger remains exactly bound to its immutable custody epoch;
4. post-cutover Atlas-management migration provenance has zero unresolved custody debt;
5. source-custody CI, architecture tests, the full test suite, and the production build are green; and
6. the Whole-System Finish Build remains the sole active implementation roadmap.

Manual closure of every historical PR is **not** part of this release gate.

After this gate, ordinary Tranche 1 product work may resume: the Knowledge Acquisition Bridge and the real `Atlas Needs From You` loop.
