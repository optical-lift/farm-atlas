# Atlas Reality Foundation Workstream v1

**Status:** Subordinate implementation workstream

This document does not replace the Atlas Whole-System Finish Build v1. `docs/architecture/atlas-source-custody.md` establishes that the Whole-System Finish Build remains the sole whole-system implementation roadmap. This document organizes only the Reality Foundation work described in the governing specifications below.

## Governing specifications

- `docs/architecture/atlas-core-reality-contract-v1.md`
- `docs/architecture/atlas-receive-reconciliation-v1.md`
- `docs/architecture/smart-contacts-elm-local-boundary-v1.md`
- `docs/architecture/elm-farm-reality-recovery-plan-v1.md`

## Intended outcome

Atlas can receive authorized observations, preserve provenance, resolve identity, reconcile events and corrections, invoke the correct domain contract, and expose one trustworthy relationship history without requiring callers to know internal tables. Elm Local is separated from Atlas Core and offered through the optional Smart Contacts integration.

## Ordered work

1. **#787 — Census current reality paths.** Inventory and classify existing identity, communication, commerce, outreach, route, projection, and integration paths.
2. **#788 — Atlas-owned canonical identity.** Establish canonical parties, people, organizations, places, aliases, contact points, and external identity links.
3. **#789 — Atlas Receive v1.** Build the common evidence-intake and reconciliation spine.
4. **#790 — Canonical relationship timeline.** Build current-position, timeline, open-loop, and provenance read models.
5. **#791 — Smart Contacts extraction.** Put Elm Local behind an integration adapter and remove Core identity dependence on it.
6. **#792 — Universal Rounds.** Evolve the existing operational-route foundation into durable field-round memory.
7. **#793 — Elm Farm reality backfill.** Migrate scattered buyer/outreach history with original provenance retained.
8. **#794 — Assistant write cutover.** Make ordinary assistant-origin memory use Atlas Receive/domain contracts instead of direct schema routing.

Later items may be designed in parallel, but implementation cutover must respect these dependencies.

## Acceptance tracks

### Identity

Flowerama/Recinna, House of Flowers current-buyer uncertainty, Rose Among Thorns owner vs purchasing authority, and Smart Contacts discovery merged into existing Atlas identity.

### Events and corrections

Schaffitzel's corrected Aug. 28 sale, duplicate source observations of one occurrence, and explicit cancellation/supersession without destructive history rewriting.

### Relationship state

Linda's `not this week` remains a non-purchase rather than rejection; Mama Jean's preserves the category-manager approval dependency; Zimmerman/Kendall preserves the promised internal follow-up.

### Field work

Katie's Springfield florist round, a water-filtration technician route, and a missionary church fundraising trip must all use the same Core Round grammar.

## Workstream exit gate

This workstream is complete when:

1. normal incoming observations have one Atlas-owned intake contract;
2. canonical people, organizations, and places belong to Atlas Core;
3. integrations attach through external identities and declared authority;
4. evidence, reconciled events, and projections are structurally distinct;
5. one canonical relationship timeline/current-position read contract exists;
6. Smart Contacts / Elm Local is optional and removable;
7. Rounds preserve planned intent and actual encounter history;
8. representative Elm Farm history is migrated with provenance and correction semantics intact;
9. ordinary assistant writes no longer select internal storage destinations;
10. legacy reconstruction/write paths are retired only after parity is demonstrated.

## Governance

Implementation pull requests in this workstream should reference the relevant governing specification and GitHub issue. New schema introduced here should be classified as Core, Domain, Integration, Evidence, Projection, or migration-only.

If this workstream conflicts with the Whole-System Finish Build, the whole-system authority wins until explicitly revised.