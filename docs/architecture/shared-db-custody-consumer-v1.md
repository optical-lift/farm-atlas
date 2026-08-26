# Shared Database Custody Consumer v1

## Status

This contract supersedes the **application-release role** of the older Farm Atlas source-synchronizer after the shared `noel-core` database authority cutover at production migration `20260825203448_state_progression_sales_inventory_version_drift_adjudication_v1`.

The older Atlas source-custody files remain valid historical evidence for the pre-cutover Atlas database epoch. They are no longer the authority for the current post-cutover database surface.

## Authority after the cutover

`optical-lift/farm-atlas` owns Atlas **application source**: UI, API routes, application readers, client behavior, tests, and application architecture.

`optical-lift/noel-core-db` owns **executable database migration source** for the shared `noel-core` Supabase project, including migrations that modify `atlas.*`.

Production remains operational reality, and the production migration ledger remains deployment provenance.

A product repository may consume the shared database. It may not become a second post-fence migration authority.

## Frozen handoff anchor

Farm Atlas retains `docs/architecture/atlas-source-custody-surface-v1.json` as the frozen executable-surface anchor at the shared-database handoff. It must continue to match the `atlasAnchor` recorded by `noel-core-db/custody/production-baseline-v1.json`.

The frozen anchor is not advanced when legitimate post-fence Atlas migrations are added in `noel-core-db`.

That distinction prevents normal shared-database evolution from looking like unauthorized Farm Atlas drift.

## Current application release proof

Farm Atlas CI runs `scripts/verify-shared-db-atlas-authority.sh`.

The verifier proves all of the following before an application change may release:

1. the authoritative `noel-core-db` baseline still names `optical-lift/noel-core-db` as the sole post-fence executable migration authority;
2. Farm Atlas's frozen surface snapshot still exactly matches the handoff anchor recorded by that authority repository;
3. the live shared-database custody packet still has the exact inherited prefix recorded by `noel-core-db`;
4. the live Atlas custody packet reports zero authenticated RPC-registry drift;
5. every Atlas-management migration after the shared-database fence appears in the live shared migration ledger; and
6. every such post-fence Atlas migration has byte-exact canonical source on `noel-core-db` `main`.

The Farm Atlas application release therefore follows the database authority rather than maintaining a competing current-surface snapshot.

## What the verifier deliberately does not do

It does not copy post-fence migrations back into Farm Atlas.

It does not delete legitimate database functions merely because the frozen Farm Atlas handoff snapshot has fewer artifacts.

It does not waive migration provenance.

It does not treat Write Now or Noel-only migrations as Farm Atlas source obligations merely because they share the same physical Supabase project.

It does not mutate production.

## Ongoing database governance

Whole-project migration custody belongs in `noel-core-db` CI. Farm Atlas verifies the Atlas-relevant slice as a consumer so an application release cannot silently depend on uncustodied Atlas database changes.

If production Atlas changes outside the governed migration path, the database-authority repository is responsible for detecting and reconciling that database drift. Farm Atlas must not repair such drift by reasserting application-repository migration authority.
