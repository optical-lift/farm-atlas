# Atlas Core Identity Reconciliation — Database Custody v1

**Status:** Application-side custody contract for Reality Foundation #788  
**Database authority:** `optical-lift/noel-core-db`

## Boundary

`farm-atlas` owns Atlas application behavior, product contracts, consumer tests, and the architectural requirements for evidence-first identity reconciliation.

It does **not** own executable post-fence migrations for the shared `noel-core` Supabase project.

The canonical database implementation for #788 is owned by `optical-lift/noel-core-db` under the post-fence Atlas migration lane.

## Required database surface

The database authority must provide the following Atlas Core identity substrate without introducing a foreign-key dependency on `local_intel`:

- `atlas.identity_subjects`
- `atlas.identity_source_records`
- `atlas.identity_claims`
- `atlas.identity_source_subject_assertions`
- `atlas.identity_subject_pair_assertions`
- `atlas.identity_reconciliation_reviews`
- `atlas.identity_reconciliation_adjudications`
- `atlas.identity_subject_projections`
- `atlas.v_identity_parties_v1`

The ordinary application projection and governed review/provenance contracts are:

- `atlas.identity_party_projection_v1(uuid)`
- `atlas.identity_subject_provenance_v1(uuid)`
- `atlas.identity_review_queue_v1(uuid)`
- `atlas.identity_adjudicate_review_v1(uuid,text,text)`

## Semantic invariants

1. The durable Core identity anchor is a thin tenant-scoped subject UUID.
2. Source/provider/legacy rows remain evidence and are linked rather than copied into canonical authority.
3. Names, aliases, contact coordinates, provider IDs, and person/organization/place classification are claims/projections, not required subject columns.
4. Explicit non-match and explicit subject-distinct evidence are preserved.
5. Mistaken identity reconciliation can be corrected without deleting prior evidence.
6. Human review distinguishes **Same**, **Different**, and **Not enough evidence**. Insufficient evidence remains unresolved.
7. `Party`, `Person`, `Organization`, and `Place` are read/application projections over reconciled evidence.
8. Smart Contacts / Elm Local may contribute provider evidence but may not own Atlas identity.
9. Authenticated application callers may use governed read/review contracts but may not directly mutate the identity evidence ledger.
10. Production release and migration validation remain the responsibility of `noel-core-db`.

## Application-repository guard

No timestamped migration newer than the shared-database custody fence may be added under `farm-atlas/supabase/migrations/`. The existing `scripts/check-shared-db-migration-custody.sh` gate is authoritative for that repository boundary.

Application tests should verify these requirements and the absence of competing post-fence migration ownership. Database postconditions and production-shaped migration validation belong in `noel-core-db`.
