# Atlas Source Custody

**Status:** Governing repository contract for the Atlas Whole-System Finish Build v1

## Authority is split on purpose

Atlas management software is one operating system, but its authorities are not interchangeable:

1. **Repository `main` — executable source authority.** Application code, schema/rules, tests, contracts, and the expected executable-surface contract live here.
2. **Canonical production state — operational reality.** Crops, observations, decisions, resources, results, placements, and other live operating facts are production truth rather than source code.
3. **Supabase migration ledger — deployment provenance.** It proves what migration was actually applied, when, and with what deployed bytes.
4. **Source-custody registry — reconciliation memory.** It defines which live Atlas surface families are release-blocking and preserves append-only adjudication evidence. It does not own executable architecture and cannot override a live catalog mismatch.
5. **Atlas Whole-System Finish Build v1 — development-direction authority.** Specialist plans remain subordinate domain specifications.
6. **Old branches and pull requests — salvage/history only.** They may supply evidence but never remain a parallel source of architectural truth.
7. **Atlas/Noel Intelligence Network — separate product.** Research-only migrations are not Atlas release blockers merely because both products share a Supabase project.

No authority is allowed to impersonate another.

## Three-layer proof

Tranche 0A uses three independent custody layers.

### 1. Current-state equivalence — primary release proof

The repository owns `docs/architecture/atlas-source-custody-surface-v1.json`. It is the expected fingerprint contract for the current governed Atlas executable surface.

Production exposes the observed surface through service-only catalog readers:

- `atlas.source_custody_live_surface_v1()`
- `atlas.source_custody_live_packet_v1()`

Those readers derive directly from PostgreSQL catalogs rather than from editable registry claims. They cover five release-blocking families:

- Atlas function definitions, signatures, security-definer state, and function configuration;
- Atlas row-level-security policies;
- Atlas non-internal triggers;
- Atlas table constraints; and
- the active authenticated/anonymous/service RPC privilege contract.

Each artifact has a SHA-256 fingerprint. Each family fingerprint is SHA-256 over the ordered artifact identity + artifact hash sequence. Therefore adding, removing, or changing any governed artifact changes the family contract.

`scripts/compare-atlas-source-custody-surface.mjs` compares the repository-owned expected family contract with the live catalog-derived family contract. `SURFACE_MISMATCH`, `MISSING_LIVE_FAMILY`, and `UNEXPECTED_LIVE_FAMILY` are release failures.

The source-custody registry itself is excluded from its live fingerprint so the measurement mechanism cannot create recursive fingerprint churn.

### 2. Source ownership and governed adjudication

Production contains:

- `atlas.source_custody_surface_families`
- `atlas.source_custody_adjudications`

`source_custody_adjudications` is append-only. UPDATE and DELETE are rejected by the database. An adjudication can explain provenance or supersession, but it cannot make a current executable-surface mismatch pass.

The known Grow Room timestamp divergence is recorded here: production deployed `20260727181055_trail_foundation_grow_room_v1`; repository history merged the identical Git blob under `20260727193000_trail_foundation_grow_room_v1` in PR #81. Both blobs are `8fb94ffe8019f9829808a57d51b317614da90151`, so the version drift is accepted as provenance without silently rewriting migration order.

### 3. Historical deployment provenance — secondary proof

`scripts/reconcile-production-migration-history.sh` still reconciles the shared Supabase migration ledger with repository source. It remains necessary because a clean current surface does not erase the requirement to account for how production got there.

For Atlas management it recognizes:

- **VERIFIED** — exact production version and exact deployed bytes exist in repository source.
- **MISMATCH** — exact version exists but repository bytes differ. Hard failure.
- **MISSING** — no source candidate exists. Hard failure.
- **VERSION_DRIFT_MATCH** — one same-name repository migration exists at another timestamp with identical bytes and requires governed adjudication.
- **ADJUDICATED_VERSION_DRIFT** — identical-byte timestamp divergence has an accepted append-only custody adjudication.
- **VERSION_DRIFT_MISMATCH** — same-name alternate version differs from deployed bytes. Hard failure.
- **AMBIGUOUS_NAME_DRIFT** — multiple alternate-version candidates exist. Hard failure.

Migration timestamps are never silently renamed because ordering is executable semantics.

## Canonical Source Synchronizer

The release membrane is:

- `scripts/atlas-source-synchronizer.sh`
- `npm run sync:atlas:source`

Its order is deliberate:

1. obtain the current live Atlas catalog fingerprint;
2. require exact equivalence with the repository-owned expected surface contract;
3. require `atlas.authenticated_rpc_registry_drift_v1()` to report zero drift;
4. export accepted version-drift decisions from the append-only custody registry into the reconciler's temporary interchange format; and
5. require migration provenance reconciliation to have zero unresolved debt.

The synchronizer is read-only against production. The production schema used to support custody is installed through ordinary governed migrations; the synchronizer itself never deploys, repairs operational data, changes scheduling, or edits adjudications.

## Product boundary

The production project also contains Noel / Intelligence Network history. Historical migration reconciliation scopes Atlas management custody to deployed SQL that touches `atlas.*`. The current executable-surface proof is likewise restricted to the `atlas` schema plus the Atlas RPC registry. Cross-product code that actually mutates Atlas remains visible; research-only product history does not become an Atlas release blocker.

## Hard rules

- A current live Atlas surface mismatch is never waived by historical migration adjudication.
- No in-scope production migration may remain unresolved as MISSING, MISMATCH, VERSION_DRIFT_MISMATCH, AMBIGUOUS_NAME_DRIFT, or unadjudicated VERSION_DRIFT_MATCH.
- The custody registry records the relationship among authorities; it never becomes executable source authority.
- Recovery prefers exact production bytes when reconstructing deployment provenance.
- A stale branch is never merged wholesale merely because production contains some of its ideas.
- Closing historical PRs is repository hygiene, not a source-custody release prerequisite once no unique executable authority remains outside `main`.
- Ordinary product changes do not belong inside custody repair unless required to restore source/live equivalence.

## Tranche 0A exit gate

Tranche 0A is complete when:

1. the repository-owned executable-surface contract exactly matches the catalog-derived live Atlas surface;
2. the governed Atlas RPC drift count is zero;
3. migration provenance has no unresolved Atlas-management custody debt after append-only adjudications are applied;
4. source-custody CI, architecture tests, the full test suite, and the production build are green; and
5. the Whole-System Finish Build remains the sole active implementation roadmap.

Manual closure of every historical PR is **not** part of this release gate.

The custody registry migration is governance infrastructure and intentionally changes production metadata/schema; it does not change Atlas operational business behavior. After this gate, ordinary Tranche 1 product work may resume: the Knowledge Acquisition Bridge and the real `Atlas Needs From You` loop.
