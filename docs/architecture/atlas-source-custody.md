# Atlas Source Custody

**Status:** Governing repository contract for the Atlas Whole-System Finish Build v1

## One cohesive Atlas

Atlas management software is one operating system. Its architecture is not divided among `main`, production-only database migrations, old pull-request branches, Dropbox plans, and remembered conversation state.

The governing authorities are:

1. **Repository `main` — executable source authority.** Current application code, migrations, tests, and architecture guards required to reproduce Atlas must live on `main`.
2. **Supabase production — deployed-state evidence.** Production proves what is actually live. It is not an alternate source-code repository. Any production-only migration is source-custody debt and must be recovered to repository source before ordinary feature work proceeds.
3. **Atlas Whole-System Finish Build v1 — active roadmap authority.** Specialist plans remain domain specifications. They do not become parallel implementation roadmaps.
4. **Old branches and pull requests — historical/salvage evidence only.** Once valid source, tests, and requirements are recovered onto current `main`, stale branches do not retain architectural authority.

The Atlas/Noel Intelligence Network is a separate product and is not folded into this management-software source-custody program.

## Existing canonical recovery mechanism

Atlas already has a repository-level production migration reconciler:

- `scripts/reconcile-production-migration-history.sh`
- `npm run audit:migrations:production`
- `npm run restore:migrations:production`

That mechanism reconstructs production-recorded migration bytes from `supabase_migrations.schema_migrations`, verifies Git blob identity, and never applies migrations to production. It is the canonical migration-history recovery mechanism. This source-custody build extends its coverage; it does not create a second reconciler.

## Prior recovery work already on `main`

Source custody is not starting from zero. The following completed releases already restored major production/source gaps and remain authoritative:

- **PR #410** — Principal OS production migration history and acceptance guards;
- **PR #412** — exact Worker/Harvest production migration history from `20260815225715_harvest_flower_reconciliation_v1` through `20260816184536_worker_day_chronology_committed_state_v1`, plus the canonical migration reconciler;
- **PR #413** — Worker Clock / Worker Day source surfaces over the recovered production contracts;
- **PR #414** — Harvest physical-output, preparation, Ready inventory, commercial, fulfillment, and related task-focus source surfaces;
- **PR #427** — later Worker/Clock/Reality Expression migration parity and RPC privilege/registry reconciliation;
- subsequent parity releases such as #456, #494, #496, #500, and #502 already own their specific production-live corrections on current `main`.

Source custody must therefore discover the **remaining negative space** rather than re-recovering architecture already owned by `main`.

## Hard rules

- No production migration may remain absent from repository source.
- No new production database behavior may be applied first and left to be reconstructed later as normal practice.
- A stale branch is never merged wholesale merely because production contains some of its ideas.
- Recovery prefers exact production migration source. When a historical branch contains the exact deployed migration, its blob may be restored directly. When production differs from branch history, the production migration ledger and the canonical reconciler are the recovery authority.
- Source-custody recovery is parity-only: it does not reapply migrations, repair operational data, alter scheduling, or introduce new product behavior.
- Product defects discovered during recovery are mapped into the Whole-System Finish Build; they are not fixed opportunistically inside parity recovery.
- Completed foundations remain closed unless parity evidence proves their source is missing or broken.
- A prior merged source-recovery PR is not repeated simply because the older feature branch that preceded it remains open.

## Current recovery program

Branch: `recovery/atlas-source-custody-v1`

Stable base: `7990fbd40d5d194707f9354c7bef234df22743e9`

### Recovered in source-custody slice 1

The following production-live management foundations are restored to repository source without changing production:

- workflow handoffs and completion-impact auditing;
- production lot identity and seed lineage;
- production capacity planning;
- Owner production-capacity answer/assignment machinery;
- production sowing/germination/seedling stages;
- transplant gates and transplant execution.

### Remaining negative-space audit

Before adding any source, compare the exact production migration version/name against current `main`. Recover only confirmed gaps.

Known remaining classes include:

1. **July Production continuation** — field stands, field care, harvest-readiness, postharvest, and closely related production lineage migrations that remain live in Supabase but are not represented on current `main`.
2. **Early Worker/Day source gaps** — production-live Aug. 12–14 corrections still absent from current `main`; recover only the deployed subset and explicitly exclude never-deployed crop-protection/deer proposals from historical PR #335.
3. **Early Harvest commercial history** — exact production-version flower output/preparation/commercial migrations that precede PR #412's `20260815225715` recovery boundary. Harvest application source itself was already recovered by #414.
4. **Community Registration production history** — the exact consolidated production migration, after which Community Registration may remain parked as a non-blocking feature family.
5. **Structured Work live subset** — production-live migrations stranded behind PR #506, without importing undeployed generic-result or later proposal work merely because it shares the branch.
6. **Final whole-history reconciliation** — run the canonical production migration audit across the complete Atlas management migration history, not merely a recent date window, then disposition stale PRs only after unique source/tests/requirements are secured.

## Source authority by artifact type

- **Executable code and schema history:** repository `main`.
- **What is currently deployed:** production state, reconciled back to `main`.
- **Development order and finish line:** Atlas Whole-System Finish Build v1.
- **Domain-specific behavioral detail:** specialist specifications, subordinate to the master build.
- **Historical intent / salvage evidence:** old PRs and branches.
- **External-world research/intelligence:** separate Intelligence Network product.

No one of these is allowed to impersonate another.

## Exit gate

Tranche 0 source custody is complete only when:

1. every production-live Atlas management migration required for current behavior has repository source;
2. current `main` contains the application source and tests that own live behavior, or an explicit current replacement owns that behavior;
3. the canonical production migration audit reports no unaccounted production-only management migrations in the audited history;
4. no open historical PR is being treated as a parallel source of product truth;
5. the recovery diff is parity-only and does not mutate production;
6. CI/build pass from the recovered source;
7. the remaining Atlas roadmap is represented by the Whole-System Finish Build rather than branch archaeology.

Only after that gate does ordinary Tranche 1 product work begin: the Knowledge Acquisition Bridge and the real `Atlas Needs From You` loop.