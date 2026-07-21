# Atlas Backend Foundation Checkpoint — July 21, 2026

## Release posture

PR #43 is a draft release candidate. The deployed Atlas interface remains the visual source of truth. Day, Week, Month, Mowing, Weeding, Owner, Worker Today, and Worker Today CSS are unchanged from deployed commit `3c5bacaae61a411ae897dc9994d0b7d08ca27792`.

## Secure task execution

- `/api/atlas/task-transition` is the only active task-result mutation route.
- Owner and Farm-Hand transitions use separate membership-aware RPCs.
- Anna retains Done and Unfinished, including Partly done, Blocked, Tomorrow, Next week, Pick a date, Changed plan, Not relevant, checklist Mark done, and Reopen.
- Completion preserves field logs, object history, child closure, idempotency, and recurring mowing generation.
- Task-card and homepage reads use membership-scoped RPCs.

## Live data repairs

- Removed six Entry Billboard sowing tasks from the Weeding collection without changing their blocked sowing state, dates, assignments, projections, or object links.
- Closed 14 stale checklist children whose parents were already terminal.
- Repaired checklist normalization so archived or skipped children cannot be reopened by stale `checklist_status=open` metadata.
- Added a partial unique index preventing more than one active task per `(farm_id, engine_instance_key)`.
- Verified zero active duplicate engine instances and zero duplicate active Mowing or Weeding collection members.

## Membership-scoped operations

The following operations now use cookie-backed authenticated Supabase clients and membership-checking database functions:

- task-card reads
- homepage Anna-task reads
- owner and Farm-Hand task transitions
- object workbench reads
- object event logging
- crop observations
- field-log creation
- germination checks
- closeout saves
- production dashboard changes
- production-plan regeneration and succession state changes
- production-rule plan creation

Anonymous execution is revoked for all new functions.

## Legacy route reduction

Removed unused or duplicate API and client stacks for dashboard, farm snapshot, inbox, maintenance preview/control/plan/completion, operational reconcile, projects, rhythm, crop profiles, task-child toggle, task crop, duplicate task list, task unfinished, duplicate task-result engine, and the old worker transition route.

Two service-role readers remain temporarily:

- germination history
- zone registry

Both are GET-only and protected by the proxy's active Elm Farm membership check. Closeout and germination POST requests are transparently rewritten to secure membership routes. CI fails any executable service-role mutation that lacks a secure rewrite.

## Rollback-only database proofs

Rollback tests left no proof rows and verified:

- done, partial, blocked, rescheduled, changed-plan, not-relevant, checklist done, and checklist reopen
- parent and child closure behavior
- one recurring mowing successor, correct timing, Anna assignment, object-link copying, and duplicate-click idempotency
- atomic field logs, zone/object links, state updates, and actor attribution
- owner/manager closeout logging and attribution
- germination not-yet rescheduling and deduplication
- germination completion, crop-cycle/object-state updates, exactly one harvest task and patch task, Anna assignment, object links, and duplicate-click deduplication
- production policy updates
- succession window moves and linked task rescheduling
- production-plan regeneration, Anna-assigned sowing tasks, and linked-object preservation
- skipped successions closing their tasks canonically
- marking a succession sown through one planting claim, one crop cycle, one field log, canonical task completion, and idempotent replay
- rule-based plan creation with successions and linked sowing tasks

## Current invariants

All currently return zero issues:

- active children under closed parents
- active duplicate engine instances
- active duplicate Mowing or Weeding collection members
- Entry Billboard sowing tasks still filed as Weeding
- surviving rollback proof tasks or production plans

## CI

Atlas CI run 185 passed the architecture boundary audit, direct transition-route guardrail, legacy worker-endpoint guardrail, full repository tests, and complete Next.js production build.

Do not merge or deploy PR #43 until the release window is intentional and the post-deploy visual and mobile verification checklist is ready.
