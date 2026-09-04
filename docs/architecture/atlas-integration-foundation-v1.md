# Atlas Integration Foundation v1

## Status

Portable application architecture for `atlas/integration-foundation`.

This branch is a construction lane for integration code that can move into the future Atlas repository without carrying the old farm-first UI with it. It does not change the Vercel release surface and it does not claim database-migration authority.

## Existing authority we are extending

Atlas already has a source-custody and evidence spine in the shared `noel-core` Supabase project:

- `atlas.connected_sources` registers an externally authorized account under exactly one human or organization custody root.
- reusable provider credentials are explicitly forbidden from `atlas.connected_sources`.
- `atlas.evidence_records`, `atlas.claim_records`, and `atlas.claim_evidence_links` separate observations from governed claims.
- the communication subsystem already demonstrates the intended order: source -> capture -> custody -> reconciliation -> interpretation -> authorized state.
- communication events are evidence-only at capture and may not silently change governing state.

The integration foundation generalizes that pattern for calendar, files, email, messaging, finance, forms, commerce, and future providers. It must not create a rival generic truth store beside the existing Atlas evidence and domain ledgers.

## Repository and database custody

`optical-lift/farm-atlas` owns the application-side integration contracts, provider adapters, normalization code, tests, UI clients, and Edge Function source that belongs to the Atlas product.

The shared production database has a separate executable migration authority: `optical-lift/noel-core-db`. Any post-fence change to the live `noel-core` database, including a change to `atlas.*`, must be authored and released there with the `atlas_` owner prefix. Farm Atlas consumes that database authority; it does not create a second migration ledger.

This means this branch may define the desired application contract before a database extension exists, but an executable DDL change must be paired with a governed `noel-core-db` migration rather than added to `farm-atlas/supabase/migrations`.

## Governing integration flow

```text
provider
  -> provider adapter
  -> source envelope
  -> custody / idempotency boundary
  -> source-attributed evidence
  -> domain adapter
  -> canonical domain truth or governed claim
  -> escalation / Principal arbitration when warranted
  -> UI projection
```

A provider never writes directly into a screen model and never earns Principal attention merely because it emitted an event.

## Required boundaries

### 1. Source identity is not human identity

A provider account is a source. A mutable email address, phone number, workspace label, or calendar name is a hint, not an Atlas person identity. Use the provider's durable account identifier when one exists.

### 2. Custody is explicit

Every connected source belongs to exactly one human or organization root. An adapter must carry that custody context through ingestion. Cross-custody joins require an explicit Atlas relationship or authorization boundary.

### 3. Credentials are outside canonical source records

No password, OAuth access token, OAuth refresh token, API secret, private key, bearer token, or reusable webhook secret may appear in a source record, event envelope, normalized evidence payload, log payload, or GitHub source file.

Application code may refer to an opaque secret handle or environment variable name. Secret material lives in the deployment/provider secret facility appropriate to the runtime.

### 4. Capture defaults to evidence, not state mutation

Receiving an external event proves only what the source reported or exposed. Capture must preserve source time, Atlas receive time, provider event identity, and provenance. A domain adapter may promote evidence into canonical domain truth only through that domain's existing authority contract.

### 5. Idempotency is mandatory

Provider retries must be safe. Every captured event needs a stable source event reference when available and an Atlas idempotency key. If the provider cannot supply a durable event id, the adapter must derive a deterministic fingerprint from stable source fields and document the collision policy.

### 6. Time has multiple meanings

Do not collapse provider occurrence time, observation time, effective time, Atlas receipt time, and sync time into one timestamp. Preserve whichever meanings the source can warrant.

### 7. Sync health is first-class

A connection must be able to report authorization state, last successful sync, cursor/checkpoint state, coverage or window, and the latest error without pretending stale data is live.

### 8. Push before polling when the provider warrants it

Prefer provider webhooks/change notifications/event streams for change detection when they are reliable and supported. Use scheduled pull/sync for initial hydration, gap repair, providers without push, and periodic reconciliation. A webhook is a wake-up signal unless the provider contract makes the payload itself authoritative and complete.

### 9. UI independence

Provider adapters and source contracts may not import Next.js routes, React components, Vercel APIs, or farm dashboard code. UI code calls the integration boundary; the integration boundary does not call UI code.

### 10. Principal arbitration remains downstream

External urgency does not equal Atlas urgency. Calendar commitments, financial exceptions, messages, orders, and other provider facts become Principal candidates only through the appropriate Atlas domain and escalation rules.

## Portable application modules

The branch owns this shape:

```text
lib/atlas/integrations/
  contract.ts          # provider-neutral source/custody/event contracts
  adapter.ts           # provider adapter interface and invariants
  providers/           # provider-specific implementations
  normalization/       # source -> Atlas evidence/domain adapters
  health/              # connection and sync health projections

docs/architecture/
  atlas-integration-foundation-v1.md

tests/
  atlas-integration-foundation.test.mjs
```

Provider-specific Edge Functions may later live under `supabase/functions/` when the runtime is genuinely Supabase-owned. They must consume the same provider-neutral contracts conceptually and must not become a second truth model.

## Database extensions anticipated but not yet authorized here

The live `atlas.connected_sources` record already carries authorization state, granted scopes, capabilities, last sync, and metadata. Before adding tables, prefer extending application behavior around that contract.

Likely future database needs should be introduced only when a real provider proves them necessary. Candidates include:

- append-only connection lifecycle events;
- sync-run receipts and failure history;
- durable per-source cursor/checkpoint state;
- webhook delivery receipts and deduplication;
- provider-specific opaque secret references if a safe secret facility requires one;
- provider capability declarations that need queryable columns rather than metadata.

None of these should be added merely to make the schema look complete.

## First provider acceptance test

A provider is considered integration-ready before UI work when Atlas can prove all of the following without Vercel:

1. establish or represent an authorized connected source without storing reusable credentials in canonical tables;
2. ingest the same fixture/event twice without duplicating evidence or domain truth;
3. preserve source identity, custody, timestamps, raw-source fingerprint, and Atlas receive time;
4. surface connection/sync health and stale/error state;
5. normalize into Atlas evidence first;
6. promote into a domain only through that domain's authority boundary;
7. revoke or disconnect the source without deleting historical source-attributed evidence;
8. replay an ingestion fixture deterministically;
9. pass security and architecture tests without a Next/Vercel dependency.

## Migration rule for the future clean Atlas build

When Atlas moves to its clean repository, move the portable integration modules and their tests as one subsystem. Do not copy the shared database's historical migration ledger into the new application repository. The new build should either continue consuming the governed shared database authority or establish an explicit database-custody handoff before any new migration ledger begins.
