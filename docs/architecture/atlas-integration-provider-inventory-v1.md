# Atlas Integration Provider Inventory v1

## Purpose

This inventory records what is actually connected or implemented today versus what is merely planned. It is intentionally conservative: a provider is not called connected until Atlas can point to a live source/connection record or an operating ingestion path.

The portable integration foundation lives on `atlas/integration-foundation` in `optical-lift/farm-atlas`. Vercel is not part of this lane. Shared-database DDL remains under the migration authority of `optical-lift/noel-core-db`.

## Status vocabulary

- **operational** — a real Atlas source/relay exists and has been used to ingest or synchronize source-attributed data.
- **registered, not connected** — Atlas knows the provider/capability but no authorized live provider account is currently connected.
- **not yet verified** — no live Atlas connection has been established or verified during this inventory pass.
- **portable adapter ready** — provider-specific code has been brought under the provider-neutral integration contract on this branch.
- **authorization foundation ready** — the provider family has a portable authorization/scoping contract, but no claim is made that a live external account is authorized.

## Verified providers

### Apple Messages

**Status:** operational; portable adapter ready; live custody authority verified.

Verified live state:

- provider key: `apple_messages`
- connected source exists in `atlas.connected_sources`
- display label: `This Mac · Apple Messages`
- provider account key: `local_apple_messages_fixture`
- authorization state: `connected`
- capability: communication
- a provider connection event records the local relay as connected
- the existing macOS exporter/relay preserves a durable source event reference, content SHA-256, occurrence time, Atlas capture time, and evidence-only authority
- live database custody is owned by `atlas.ingest_communication_events_relay_api_v1`

Branch work:

- `lib/atlas/integrations/providers/apple-messages.ts` wraps the existing communication event in the common integration envelope without changing its authority.
- `appleMessagesEnvelopeToEvidence()` normalizes the event into source-attributed communication evidence.
- `processLegacyAppleMessagesEvent()` routes it through evidence custody with no domain adapter.
- `lib/atlas/integrations/runtime/communication-relay.ts` maps a one-event legacy relay receipt into the portable custody receipt without importing database/hosting code.
- the compatibility mapper requires a resolved communication event ID for admitted/replayed evidence and maps source-content conflicts without fabricating custody.

Next gate:

- expose `atlas.communication_source_health_self_api_v1` through the common sync-health contract;
- preserve the existing communication ledger/RPC as the custody authority rather than replacing it.

### Gmail

**Status:** registered, not connected; Google authorization foundation ready; read-scope policy ready.

Verified live state:

- Gmail is registered in the communication-provider model as an intended OAuth mailbox/provider.
- the latest verified connection state is `not_connected`.
- no live Gmail credentials or authorized mailbox are assumed by this inventory.

Branch work:

- `lib/atlas/integrations/providers/google/oauth.ts` provides the shared Google web-server authorization contract with offline access, incremental authorization, callback-state validation, HTTPS redirect validation, and opaque secret handles.
- `lib/atlas/integrations/providers/google/gmail.ts` defines two explicit read profiles: `gmail.metadata` for metadata-only capture and `gmail.readonly` when message bodies/settings evidence is actually required.
- no send, modify, compose, settings-write, delete, or broad mail scope is requested by the foundation.

Next gate:

- create the real Google OAuth client and place client/connection secrets in the runtime secret facility, not Atlas source records;
- implement Gmail source identity, initial hydration, history cursor/change notification, periodic reconciliation, and sync health against the common integration contract;
- authorize a connected source only after the real OAuth callback succeeds.

Do not build Gmail UI as if a mailbox is already connected.

## Providers not yet verified as live Atlas connections

### Google Calendar

**Status:** not yet verified; Google authorization foundation ready; read-scope policy ready.

No live Google Calendar connected-source record or operating Atlas adapter was verified in this pass.

Branch work:

- Calendar shares the provider-family OAuth foundation but remains a separate capability.
- `lib/atlas/integrations/providers/google/calendar.ts` requests only `calendar.calendarlist.readonly` plus `calendar.events.readonly` for initial read integration.

Next gate:

- define calendar event identity, recurrence/update handling, cancellation, provider occurrence/update timestamps, initial hydration, change notification, and periodic reconciliation;
- authorize Calendar incrementally rather than silently broadening a Gmail grant.

### Dropbox

**Status:** not yet verified.

No live Dropbox connected-source record or operating Atlas adapter was verified in this pass.

Likely next gate:

- decide which Dropbox capability Atlas actually needs first: file discovery, selected-folder custody, file ingestion, or continuous change observation;
- use durable provider file/folder identities rather than path text as the canonical external identity;
- preserve revision/content fingerprint and source provenance when a file enters Atlas evidence.

### Otter.ai

**Status:** not yet verified.

No live Otter connected-source record or operating Atlas adapter was verified in this pass.

Likely next gate:

- define whether Atlas is consuming meeting metadata, transcript text, summaries/action items, or all of them;
- preserve meeting/transcript identity and source timestamps;
- treat extracted tasks/claims as interpretation downstream of transcript evidence, not as facts merely because Otter emitted them.

## Cross-provider infrastructure already available

The live Atlas database already contains important pieces of the integration spine:

- `atlas.connected_sources` for provider account registration under explicit custody;
- `atlas.evidence_records` for source-attributed evidence;
- `atlas.claim_records` and claim/evidence links for governed interpretation;
- communication capture/ledger structures that demonstrate source-first, evidence-only ingestion;
- `atlas.ingest_communication_events_relay_api_v1` for live communication relay custody;
- `atlas.communication_source_health_self_api_v1` for current-user communication-source health;
- provider registration/connection-event structures under `local_intel` for communications.

The branch adds the portable application contract around those existing authorities rather than introducing a second generic truth store.

## Cross-provider gates before broad connection work

### Secret custody

Reusable OAuth tokens, refresh tokens, API keys, private keys, passwords, and webhook signing secrets must not live in `atlas.connected_sources`, provider event payloads, logs, or GitHub. Provider adapters may hold only opaque secret references or environment/configuration handles.

### RLS/security hardening

The current Supabase security advisor reports exposed tables with RLS disabled, including Atlas/shared-database surfaces relevant to this work. Do not mechanically enable RLS without policies: that can either break the application or create misleading security. The correct next action is to design the actual read/write/custody policies and release them through `optical-lift/noel-core-db` under shared-database migration custody.

No RLS/DDL changes are made by this branch.

### Idempotency and replay

Every provider must tolerate duplicate webhook deliveries, cursor replay, and sync overlap. Source event ids are preferred; deterministic source fingerprints are the fallback when the provider lacks a durable event id.

### Sync health and freshness

Every connected source must eventually expose authorization state, last attempt, last successful synchronization, cursor/checkpoint, coverage window, and latest error. Atlas must not call stale or partially covered data live.

### Push plus reconciliation

Use provider push/change notifications when reliable and supported, but keep pull synchronization for initial hydration, missed-event repair, coverage reconciliation, and providers without push. A webhook should normally wake Atlas rather than become an unexamined direct mutation of canonical state.

## Recommended build order from this inventory

1. **Expose Apple Messages health through the common contract**; custody compatibility is now proved against the live RPC.
2. **Implement Gmail ingestion/sync on the shared Google OAuth foundation**; the live mailbox remains unconnected until real authorization succeeds.
3. **Implement Google Calendar sync on the same provider-family authorization foundation** while preserving independent capability/scopes.
4. **Add Dropbox** once the exact file-custody use case is selected.
5. **Add Otter.ai** with transcript-as-evidence and interpretation downstream.
6. Add other providers only after their real Atlas use case establishes the needed contract extension.

This order is evidence-driven rather than UI-driven: existing operational truth comes first, then already-registered intended integrations, then new provider categories.
