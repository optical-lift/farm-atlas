# Elm Directory — Live Commerce Handoff

**As of:** 2026-08-18  
**Branch:** `agent/elm-directory-live-commerce-v1`  
**Live database:** Supabase project `noel-core` (`zirqkouammpwxlqfbsvf`), schema `local_intel`

## Repository history warning

The live `local_intel` schema exists in Supabase but its original baseline migrations are not present in the current `farm-atlas` GitHub migration history. The migrations on this branch are therefore **forward migrations against the existing live Elm baseline**, not a claim that GitHub can bootstrap `local_intel` from zero.

Do not deploy these migrations to an environment that does not already have the Elm `local_intel` baseline. A future baseline-export/reconciliation pass is still required for clean-environment reproducibility.

## State reached in this pass

### Priority-1 product visibility

Started with 23 open P1 `find_product` gaps.

Current result: **0 open P1 product-visibility gaps.**

The pass added 22 structured assortment offerings and enriched the existing Round Table farmstand offering rather than duplicating it. Assortment/category truth is intentionally separate from current stock truth.

The rule is:

> Elm may say that a provider carries/sells a product category when durable evidence supports it. Elm may only say the product is available now when a current expiring availability assertion supports it.

### Priority-1 live availability

Started with 27 open P1 `check_availability_now` gaps.

The stored gaps remain open because live questions cannot be resolved forever. They are now evaluated through `local_intel.v_live_availability_gap_state`:

- `covered` while a matching unexpired assertion exists
- `open` again automatically when that assertion expires

At the end of this pass:

- **3 currently covered** by fresh business-controlled observations
- **24 currently open**
- of the 24 open, **23 have a ready-to-contact availability-refresh target**
- **1 needs a contact path**: Old Earth Acres & Old Earth Sips

The three current observations were intentionally written as expiring data in the live database and are **not replayed by migration as perpetual current truth**.

### One separate P1 connection gap

There is still one P1 `how_to_get_it` gap for **3M Marketplace**. Elm can identify the marketplace and its event location, but the current directory record still lacks a direct website/phone/email connection path for the organizer. Do not invent one from event aggregators.

## Live-availability contract

New table: `local_intel.availability_assertions`

Every current-state claim carries:

- provider/entity
- availability lane
- state
- human-readable summary
- structured details
- observed time
- valid-from time
- hard valid-through time
- source kind
- confidence/provenance metadata

New view: `local_intel.v_current_availability`

Only assertions whose validity window contains `now()` are visible as current.

New view: `local_intel.v_live_availability_gap_state`

This joins P1 live questions to current assertions and computes temporal coverage without permanently resolving the underlying question gap.

## Provider texting / provider-push ingress

Provider texting is now modeled as **current-state reporting, not profile maintenance**.

New tables:

- `local_intel.provider_update_channels`
- `local_intel.provider_messages`
- `local_intel.provider_update_candidates`

New function:

- `local_intel.apply_provider_availability_candidate_v1(uuid)`

New inbox view:

- `local_intel.v_provider_update_inbox`

### Safety/authority boundary

A provider channel must be verified and is authorized only for explicitly listed `allowed_availability_kinds`.

A provider text cannot directly rewrite:

- business identity
- durable category classification
- address
- profile description
- unrelated directory truth

It can report only authorized current-state lanes such as product inventory, lesson openings, market attendance, live location, floral inventory, venue availability, or childcare openings.

### Raw-source preservation

Inbound provider language is retained in `provider_messages` even if parsing is ambiguous, rejected, or later superseded.

Parsed claims become `provider_update_candidates`. They require:

- explicit `valid_from`
- explicit `valid_through`
- an `expiry_basis`
- parser confidence
- review state

Only approved/auto-approved candidates from a currently verified authorized channel may be applied to `availability_assertions`.

### Timezone rule

Provider channels carry a `reporting_timezone` (default `America/Chicago`). Natural-language phrases such as `today`, `tomorrow`, and `this week` must be resolved into explicit timezone-aware validity windows before the candidate can be applied.

Do not calculate those phrases using the database session timezone.

### End-to-end test completed

A transaction-only test used Parks Mtn Apiary and the example message:

> Honey restocked. Pints and quarts. Farm pickup this week.

The flow successfully produced a current `product_inventory` assertion equivalent to:

> Honey restocked: pints and quarts available for farm pickup this week.

The entire test transaction was rolled back, so no fake Parks Mtn Apiary availability remains in live data.

## Next implementation work

1. Work the 24 live-availability acquisition targets, prioritizing provider-controlled/direct evidence over weak directory evidence.
2. Create the inbound SMS transport/webhook that writes raw messages to `provider_messages` and links them to verified channels.
3. Build the parser that converts provider language into one or more `provider_update_candidates`, including Central-time expiry resolution.
4. Add the provider verification/onboarding flow so a business can authorize a phone number and the exact current-state lanes it may report.
5. Put current availability into the Elm answer/read layer so resident answers can distinguish `known source`, `available now`, `sold out`, `closed`, `unknown`, and `stale`.
6. Reconcile/export the pre-existing `local_intel` baseline into repository migration history before expecting clean-environment bootstrap.
