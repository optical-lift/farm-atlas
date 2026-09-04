# Atlas Integration Custody Pipeline v1

## Status

Portable custody and promotion ordering for `atlas/integration-foundation`.

This layer sits after provider normalization and before any domain promotion. It does not own HTTP routing, Vercel deployment, Supabase schema, or UI behavior.

## Why this boundary exists

The existing macOS Messages relay already emits canonical communication evidence events and already preserves durable source references, content hashes, occurrence time, capture time, evidence-only authority, and replay overlap. Rewriting that relay would weaken a working source-capture boundary.

The missing reusable piece was the application-side custody gate after normalization: one place that admits evidence, recognizes replay/conflict/rejection, and prevents provider capture from silently becoming domain state.

The portable sequence is now:

```text
provider capture / relay
  -> provider-neutral source envelope
  -> evidence adapter
  -> evidence custody admission
  -> stop on replay / conflict / rejection
  -> stop when authority is evidence_only
  -> optional explicit domain adapter
  -> domain write only with named authority boundary
```

## Hard ordering rules

1. `toEvidence()` may normalize a source envelope into source-attributed evidence drafts. It does not persist canonical domain truth.
2. `custody.admit()` is called before any domain adapter can run.
3. `already_in_custody`, `conflict`, and `rejected` dispositions terminate processing and produce no domain writes.
4. `evidence_only` envelopes terminate after custody even when a domain adapter happens to be available in the runtime.
5. `domain_adapter_required` envelopes remain admitted evidence when no domain adapter is available; they report `awaiting_domain_adapter` rather than manufacturing a write.
6. A domain adapter receives only an already-admitted event plus the admitted evidence IDs.
7. Every domain write returned by a domain adapter must name its `authorityBoundary`.
8. Promotion receipts must echo the same connected source, source event reference, and idempotency key as the admitted envelope.

## Apple Messages proof path

`lib/atlas/integrations/providers/apple-messages.ts` now provides the portable steps around the existing relay event:

- `appleMessagesEventToEnvelope()` wraps the existing `atlas_communication_event_v1` event without reinterpreting it.
- `appleMessagesEnvelopeToEvidence()` creates one communication `source_event` evidence draft under the connected source's explicit human or organization custody.
- `processLegacyAppleMessagesEvent()` sends that envelope through the common custody pipeline with no domain adapter.

Therefore Apple Messages can be replayed through the new integration foundation while preserving its existing rule: capture appends source-attributed evidence and cannot claim a governing state change.

## Verified live communication custody authority

The shared production database already owns the communication custody write boundary as `atlas.ingest_communication_events_relay_api_v1`.

That function was inspected read-only during this build. It already:

- validates the paired relay credential and connected source;
- requires the event source kind/account to match that source;
- requires `atlas_communication_event_v1` with `evidence_only`, `append_source_attributed_evidence_only`, and `governingStateChanged=false`;
- admits first-seen events into `atlas.communication_events`;
- recognizes same-event replay without duplicating custody;
- records source-state enrichment separately when the content hash is unchanged but custody-observed source state differs;
- records a conflict when the same source event reference arrives with a different source content hash;
- updates source sync metadata;
- returns `atlas_communication_ingest_receipt_v1` with supplied/admitted/already-in-custody/conflict counts and `governingStateChanged=false`.

The existing RPC is batch-oriented and returns aggregate counts rather than per-event evidence IDs. The integration foundation therefore does not pretend its aggregate receipt is already identical to `IntegrationEvidenceCustodyReceipt`.

## Legacy receipt compatibility

`lib/atlas/integrations/runtime/communication-relay.ts` provides a narrow compatibility mapper for runtimes that submit exactly one legacy communication event at a time.

The mapper:

- requires `supplied=1`;
- requires exactly one of admitted / already-in-custody / conflict;
- verifies connected source, provider key, and provider account against the portable envelope;
- rejects any receipt claiming a governing-state change;
- requires the runtime to resolve the `atlas.communication_events.id` for admitted or replayed evidence;
- maps conflicts without fabricating an admitted evidence ID.

It imports no database client, HTTP framework, or hosting runtime. The concrete HTTP/RPC caller remains a deployment concern outside the portable provider boundary.

## Runtime seam intentionally left open

The current `farm-atlas` repository contains the local Messages exporter/relay. The live database owns the RPC above, but the HTTP wrapper that accepts the relay bearer token, hashes/verifies it, invokes the RPC, and resolves individual event identity is not implemented in this repository under the relay's existing contract.

This branch therefore does not invent a duplicate route. A runtime that owns that wrapper can implement `IntegrationEvidenceCustody.admit()` using the existing RPC plus event-id resolution, then pass its receipt through the compatibility mapper.

## Database custody

No DDL is introduced here. The existing communication RPC is sufficient for the compatibility path. Any future shared-database table, function, trigger, RLS policy, or migration remains under the post-fence migration authority of `optical-lift/noel-core-db`.

## Acceptance checks added

Static tests now require that:

- custody admission appears before domain promotion;
- replay/conflict/rejection short-circuit promotion;
- evidence-only authority short-circuits promotion;
- evidence and domain adapters are separate interfaces;
- the portable pipeline imports no Next.js, React, Vercel, or database runtime dependency;
- Apple Messages normalizes into evidence and invokes the pipeline without supplying a domain adapter;
- the legacy relay mapper is one-event-only, source-identity-preserving, and runtime-independent;
- admitted/replayed legacy communication receipts cannot pass without a resolved evidence ID.
