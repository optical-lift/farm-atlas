# Atlas Backend Foundation Checkpoint — 2026-07-21

## Release state

Atlas now has one membership-aware operational boundary while retaining the deployed visual interface as the presentation source of truth.

The Day, Week, Month, Mowing, Weeding, Owner, Worker Today, and Worker Today CSS files remain identical to deployed commit `3c5bacaae61a411ae897dc9994d0b7d08ca27792`.

PR #43 remains draft and unmerged pending the intentional Vercel release and post-deploy visual/mobile verification.

## Membership and API boundary

Every Atlas API route now uses the signed-in user's cookie-backed Supabase session. There are zero Atlas API service-role routes.

Membership-scoped contracts cover:

- task cards and homepage work
- owner and Farm-Hand task transitions
- object workbench reads, events, and crop observations
- field logs and closeouts
- germination checks and germination history
- zone registry
- production dashboard, production plans, succession state, mark-sown, and rule-plan creation

Anonymous execution is revoked for the new database functions. Authenticated execution remains constrained inside each function by the active Elm Farm membership and applicable role or assignment rule.

`/api/atlas/task-transition` is the only active task-result mutation endpoint. CI rejects service-role API routes, direct task-transition RPC bypasses, and references to the removed worker transition endpoint.

## Anna compatibility

Anna retains the existing task interface and behavior:

- Done
- Unfinished
- Partly done
- Blocked
- Tomorrow
- Next week
- Pick a date
- Changed plan
- Not relevant
- checklist Mark done and Reopen

The transition engine preserves field logs, object history, checklist movement, recurring mowing generation, and duplicate-click idempotency.

## Live task repairs

The operational audit repaired only objective defects:

- removed six Entry Billboard sowing tasks from the Weeding collection
- attached EB1–EB6 to their real parent sowing tasks
- retained one spray-gated checklist child per Entry Billboard bed
- prevented terminal sowing parents from generating new open checklist work
- moved three iris checklist dates with their July 23 parent
- attached BW3–BW5 to the completed Teddy interplant record
- aligned BB8–BB11 Teddy succession timing and projections to the July 27 post-spray sowing date
- closed stale checklist children and prevented stale metadata from reopening terminal or blocked states
- prevented duplicate active engine instances

Ten July 20 carryovers remain open because their actual field status requires a human decision rather than a structural database repair.

## Crop and production reconciliation

The production, planting-claim, object-content, and crop-cycle graph was reconciled without flattening bed-level history:

- linked historical Cosmos, pollenless sunflower, Teddy, and Zinnia successions to existing bed crop cycles
- recorded the completed BW3–BW5 Teddy interplant as the July 18 succession
- preserved multi-bed cycle IDs in succession metadata
- created a dedicated MG10 California Giant Zinnia cycle within the owner-confirmed mixed sowing
- repaired BB4 Teddy, FR1 Cosmos, and FR16 ProCut Orange planting-claim continuity
- corrected the FR16 and FR17 content identities to their July 14 reset sowings
- required future production mark-sown actions to identify real growing objects

Current queried invariants return zero issues for:

- Anna tasks without a usable location
- metadata-only Anna assignments
- active tasks linked to terminal crop cycles
- active children beneath terminal parents
- duplicate active engine instances
- blocked tasks without a reason
- production state, date, task, or cycle-link mismatches
- planting claims without object contents or crop cycles
- active or planned crop cycles without a growing object

## Verification

Rollback-only proofs passed for all task transitions, recurring mowing, field logs, closeouts, germination flows, production policy and window changes, regeneration, mark-sown, planting claims, crop cycles, and rule-based plan creation.

Atlas CI run 201 passed:

- zero-service-role API architecture audit
- canonical transition guardrails
- homepage membership guard
- complete repository test suite
- complete Next.js production build
