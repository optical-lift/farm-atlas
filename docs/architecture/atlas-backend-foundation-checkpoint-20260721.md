# Atlas Backend Foundation Checkpoint — 2026-07-21

Atlas now has one membership-aware operational boundary while retaining the deployed visual interface as the presentation source of truth. Day, Week, Month, Mowing, Weeding, Owner, Worker Today, and Worker Today CSS remain identical to deployed commit `3c5bacaae61a411ae897dc9994d0b7d08ca27792`.

Every Atlas API route uses the signed-in user's cookie-backed Supabase session. There are zero Atlas API service-role routes. Anonymous execution is revoked for the new database functions; authenticated execution is constrained by active Elm Farm membership and the applicable role or assignment rule. `/api/atlas/task-transition` is the only active task-result mutation endpoint.

Anna retains Done, Unfinished, Partly done, Blocked, Tomorrow, Next week, Pick a date, Changed plan, Not relevant, checklist Mark done, and checklist Reopen. The transition engine preserves field logs, object history, checklist movement, recurring mowing generation, and duplicate-click idempotency.

The operational audit repaired objective defects: Entry Billboard sowing classification and bed links, duplicate checklist children, blocked checklist normalization, terminal-parent checklist generation, iris child dates, BW3–BW5 Teddy links, BB8–BB11 July 27 production timing, stale checklist children, and duplicate active engine prevention.

Ten July 20 carryovers remain open for human field-status decisions: grow-room basil readiness, lemon basil cuttings, Barn Beds mowing, Corral mowing, U-Pick walkway mowing, U-Pick sunflower weed-whacking, Rose Queen/Violet patching, FR1 cosmos patching, FR17 Horizon patching, and FR18 weeding.

The production, planting-claim, object-content, and crop-cycle graph was reconciled without flattening bed-level history. Historical Cosmos, pollenless sunflower, Teddy, and Zinnia successions now link to real bed crop cycles; the BW3–BW5 Teddy interplant is recorded as the July 18 succession; MG10 has a dedicated California Giant Zinnia cycle; BB4 Teddy, FR1 Cosmos, and FR16 ProCut Orange claim continuity is repaired; and FR16/FR17 content identities reflect their July 14 reset sowings.

Current queried invariants return zero issues for unusable Anna locations, metadata-only assignments, terminal-cycle task links, active children under terminal parents, duplicate active engine instances, blocked tasks without reasons, production state/date/task/cycle mismatches, claims without contents or cycles, and active or planned crop cycles without a growing object.

Rollback-only proofs passed across task transitions, recurring mowing, field logs, closeouts, germination, production changes, regeneration, mark-sown, planting claims, crop cycles, and rule-plan creation. Atlas CI run 201 passed the zero-service-role API audit, transition guardrails, homepage membership guard, complete repository tests, and complete Next.js production build.

PR #43 remains draft and unmerged pending the intentional Vercel release and post-deploy visual/mobile verification.
