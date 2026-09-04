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

`lib/atlas/integrations/providers/apple-messages.ts` now provides all three portable steps needed around the existing relay event:

- `appleMessagesEventToEnvelope()` wraps the existing `atlas_communication_event_v1` event without reinterpreting it.
- `appleMessagesEnvelopeToEvidence()` creates one communication `source_event` evidence draft under the connected source's explicit human or organization custody.
- `processLegacyAppleMessagesEvent()` sends that envelope through the common custody pipeline with no domain adapter.

Therefore Apple Messages can be replayed through the new integration foundation while preserving its existing rule: capture appends source-attributed evidence and cannot claim a governing state change.

## Runtime seam intentionally left open

The current `farm-atlas` repository contains the local Messages exporter/relay, but the relay's remote ingest endpoint is not implemented here under its existing manifest/admission contract. This branch therefore does not invent a duplicate HTTP route or database writer.

The runtime that owns evidence persistence only needs to implement `IntegrationEvidenceCustody.admit()`. That implementation can bind the portable pipeline to the governed Atlas evidence ledger without leaking database or hosting details back into provider adapters.

## Database custody

No DDL is introduced here. Any new shared-database table, function, trigger, RLS policy, or migration required by a future custody implementation remains under the post-fence migration authority of `optical-lift/noel-core-db`.

## Acceptance checks added

Static tests now require that:

- custody admission appears before domain promotion;
- replay/conflict/rejection short-circuit promotion;
- evidence-only authority short-circuits promotion;
- evidence and domain adapters are separate interfaces;
- the portable pipeline imports no Next.js, React, Vercel, or database runtime dependency;
- Apple Messages normalizes into evidence and invokes the pipeline without supplying a domain adapter.
