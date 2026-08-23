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

## Hard rules

- No production migration may remain absent from repository source.
- No new production database behavior may be applied first and left to be reconstructed later as normal practice.
- A stale branch is never merged wholesale merely because production contains some of its ideas.
- Recovery prefers exact production migration source. When a historical branch contains the exact deployed migration, its blob may be restored directly. When production differs from branch history, the production migration ledger is the recovery authority.
- Source-custody recovery is parity-only: it does not reapply migrations, repair operational data, alter scheduling, or introduce new product behavior.
- Product defects discovered during recovery are mapped into the Whole-System Finish Build; they are not fixed opportunistically inside parity recovery.
- Completed foundations remain closed unless parity evidence proves their source is missing or broken.

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

### Still required before source custody is complete

- production field-stand/care/harvest/postharvest continuation that is live in Supabase but absent from current `main`;
- exact production-version Harvest commercial/reconciliation migrations;
- production-live Worker/Day migration source stranded behind historical worker branches, excluding proposals that were never deployed;
- exact production Community Registration migration source, after which that feature family may remain parked;
- the production-live subset of Structured Work source from PR #506, without merging its undeployed proposals;
- final repository-vs-production reconciliation and stale-PR disposition.

## Exit gate

Tranche 0 source custody is complete only when:

1. every production-live Atlas management migration required for current behavior has repository source;
2. current `main` contains the application source and tests that own live behavior, or an explicit current replacement owns that behavior;
3. no open historical PR is being treated as a parallel source of product truth;
4. the recovery diff is parity-only and does not mutate production;
5. CI/build pass from the recovered source;
6. the remaining Atlas roadmap is represented by the Whole-System Finish Build rather than branch archaeology.

Only after that gate does ordinary Tranche 1 product work begin: the Knowledge Acquisition Bridge and the real `Atlas Needs From You` loop.