# Atlas Source Custody

**Status:** Governing repository contract for the Atlas Whole-System Finish Build v1

## One cohesive Atlas

Atlas management software is one operating system, but its authorities are intentionally distinct:

1. **Repository `main` — executable source authority.** Current application code, schema/rules, tests, contracts, and the source required to reproduce deployed Atlas behavior live here.
2. **Canonical production state — operational reality.** Crops, observations, decisions, resources, results, placements, and other live operating facts are production truth rather than source code.
3. **Supabase migration ledger — deployment provenance.** It proves what migration was actually applied, when, and with what exact deployed bytes.
4. **Atlas Whole-System Finish Build v1 — development-direction authority.** Specialist plans remain subordinate domain specifications.
5. **Old branches and pull requests — salvage/history only.** They may supply missing evidence but never remain a parallel source of architectural truth.
6. **Atlas/Noel Intelligence Network — separate product.** Research-only migrations are not made Atlas release blockers merely because both products currently share a Supabase project.

No authority is allowed to impersonate another.

## Canonical Source Synchronizer

Tranche 0A is governed by the **Atlas Source Synchronizer**:

- `scripts/atlas-source-synchronizer.sh`
- `npm run sync:atlas:source`
- low-level engine: `scripts/reconcile-production-migration-history.sh`
- deliberate drift decisions: `docs/architecture/atlas-source-custody-adjudications.tsv`

The synchronizer is read-only against production. It does not deploy migrations, repair operational data, alter scheduling, or close pull requests.

Its job is to continuously prove that current repository source owns current deployed Atlas management architecture.

### Synchronization boundary

The production project also contains Noel / Intelligence Network history. The synchronizer therefore scopes Atlas management custody to deployed migrations whose recorded SQL touches the `atlas.*` schema. A cross-product migration that mutates Atlas is included; a research-only migration is not an Atlas release blocker.

### Custody classifications

For each in-scope deployed migration the engine recognizes:

- **VERIFIED** — exact production version and exact deployed bytes exist in repository source.
- **MISMATCH** — exact version exists but repository bytes differ from deployed bytes. Hard failure.
- **MISSING** — no exact-version source and no same-name candidate exists. Hard failure.
- **VERSION_DRIFT_MATCH** — exactly one same-name repository migration exists at another timestamp with identical bytes. It must be explicitly adjudicated before it is accepted.
- **ADJUDICATED_VERSION_DRIFT** — an identical-byte timestamp divergence is recorded in the custody adjudication file. This is resolved custody, not continuing debt.
- **VERSION_DRIFT_MISMATCH** — same-name alternate version exists but deployed bytes differ. Hard failure.
- **AMBIGUOUS_NAME_DRIFT** — multiple alternate-version candidates exist. Hard failure.

Timestamp drift is never auto-renamed or auto-deleted because migration ordering is executable semantics.

The known Grow Room timestamp divergence is recorded as an intentional alias: production deployed `20260727181055_trail_foundation_grow_room_v1`, while repository history legitimately merged the identical bytes under `20260727193000_trail_foundation_grow_room_v1` in PR #81.

A current canonical implementation may supersede behavior, but **supersession never excuses missing deployment provenance**. The deployed bytes or an identical-byte adjudicated alias must still be owned in source.

## RPC custody

Migration history is not enough by itself. The synchronizer also checks `atlas.authenticated_rpc_registry_drift_v1()` and fails if the current governed RPC privilege/security surface has diverged from its registered contract.

This keeps current executable architecture synchronized with current governed production behavior rather than merely proving that filenames exist.

## Hard rules

- No in-scope production migration may remain unresolved as MISSING, MISMATCH, VERSION_DRIFT_MISMATCH, AMBIGUOUS_NAME_DRIFT, or unadjudicated VERSION_DRIFT_MATCH.
- No production database behavior should be applied first and left for later reconstruction as normal practice.
- Recovery prefers exact production bytes; production ledger bytes outrank stale branch copies when they disagree.
- A stale branch is never merged wholesale merely because production contains some of its ideas.
- Source recovery remains parity-only.
- Product defects found during custody work belong in the Whole-System Finish Build rather than opportunistic recovery patches.
- Closing historical PRs is repository hygiene, not a source-custody release prerequisite once the synchronizer proves they own no unique executable authority.

## Tranche 0A exit gate

Tranche 0A is complete when:

1. `npm run sync:atlas:source` reports zero unresolved Atlas management custody debt;
2. the governed Atlas RPC drift count is zero;
3. CI and production build are green from the recovered source;
4. the recovery diff remains parity-only and does not mutate production; and
5. the Whole-System Finish Build remains the sole active implementation roadmap.

Manual closure of every historical PR is **not** part of this release gate. Historical branches may be cleaned up afterward because they no longer participate in authority once the synchronizer proves source custody.

After this gate, ordinary Tranche 1 product work may resume: the Knowledge Acquisition Bridge and the real `Atlas Needs From You` loop.
