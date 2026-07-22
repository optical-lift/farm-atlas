# Atlas Release Candidate Manifest

## Candidate identity

- Pull request: `#43` — Restore secure shared Atlas without reducing Anna's app
- Candidate branch: `agent/restore-task-transitions`
- Candidate commit: the Git commit containing this manifest. Resolve and record the immutable SHA before acceptance.
- Production domain: `atlas.elmfarm.co`
- Supabase production project: `zirqkouammpwxlqfbsvf`
- Vercel project: `prj_ppP8y06TilUlHOtTLhQjM7hSedh6`
- Vercel team: `team_5arSaOpnt8SRptBkOggAUmuC`

The pull request remains draft and unmerged until every release gate below passes.

## Expected database baseline

The Atlas release depends on database changes that are already live and were proven with Owner, Anna/Farm-Hand, and authenticated-outsider identities.

The final live migration ledger entries required by this candidate are:

- `20260721193551_atlas_restore_shared_member_read_surface`
- `20260721194916_atlas_correct_member_snapshot_sowing_count`

Repository migration filenames must use those same versions. Renaming these files does not reapply SQL or change production data; it aligns source control with the versions Supabase already recorded.

Before release, verify:

- [ ] The live migration ledger ends at or beyond `20260721194916`.
- [ ] Both migration names exist in the live ledger.
- [ ] No repository migration with equivalent SQL remains under an earlier unmatched timestamp.
- [ ] No pending Atlas DDL migration is bundled into the release accidentally.

## Required automated evidence

Record the exact candidate SHA, then require:

- [ ] GitHub Atlas CI completed successfully for that SHA.
- [ ] Architecture guard passed.
- [ ] Complete repository tests passed.
- [ ] Next.js production build passed.
- [ ] Anna permission-matrix source test passed.
- [ ] Service-role API boundary guard passed.
- [ ] Canonical task-transition guard passed.
- [ ] No unresolved pull-request review thread remains.

Evidence fields:

- Candidate SHA:
- GitHub Actions run:
- Validate job:
- Architecture job:
- Reviewer or release owner:

## Required Vercel evidence

A READY deployment for an ancestor or runtime-equivalent commit is useful diagnostic evidence but is not the release target. The accepted preview must identify the exact candidate SHA.

- [ ] Preview deployment state is `READY`.
- [ ] Deployment metadata `githubCommitSha` equals the candidate SHA.
- [ ] Deployment belongs to PR #43 and `agent/restore-task-transitions`.
- [ ] A temporary share link or approved access path works on Anna's phone.
- [ ] Signed-out access reveals no Elm Farm operational data.
- [ ] Runtime logs show no unexplained `500`, repeated `401/403`, or request loop during acceptance.

Evidence fields:

- Preview deployment ID:
- Preview URL:
- Share-link expiration:
- Deployment commit SHA:
- Runtime-log review window:

## Authenticated Anna release gate

Run `docs/release/anna-phone-acceptance-walkthrough.md` against the exact candidate deployment.

- [ ] Shared purple homepage passes.
- [ ] Day, Week, and Month pass.
- [ ] Mowing and Weeding collections pass.
- [ ] Zones, beds, objects, crop cycles, and history pass.
- [ ] In-scope germination history passes.
- [ ] Production is readable and not mutable by Anna.
- [ ] Checklist complete and reopen persist.
- [ ] Done, Unfinished → Tomorrow, Blocked, and Rescheduled persist.
- [ ] The safe test task is restored to its original state.
- [ ] No Owner-only content or controls are exposed.
- [ ] Mobile layout and Back navigation pass.

Evidence fields:

- Tester:
- Device and browser:
- Test date/time in America/Chicago:
- Safe task ID/title:
- Original task state/date:
- Restored task state/date:
- Acceptance result: `PASS` or `FAIL`

## Environment parity check

Verify settings without copying secret values into this document.

- [ ] Preview and Production both have the required Supabase URL and public client key.
- [ ] Preview and Production point to the intended Supabase project.
- [ ] Authentication callback URLs permit the exact preview host and production domain.
- [ ] Public browser bundles do not contain a Supabase service-role secret.
- [ ] Production-domain and canonical-URL variables resolve to `atlas.elmfarm.co` where appropriate.
- [ ] Membership invite or email settings required by this release are present in their intended environment.

Record only presence, target, and reviewer—not secret values.

## Deployment method

Preferred sequence:

1. Freeze the accepted candidate SHA.
2. Complete CI, exact-head preview, runtime-log review, and Anna phone acceptance.
3. Mark PR #43 ready only after the evidence is recorded.
4. Merge deliberately using the repository's normal merge method.
5. Allow Vercel's Git integration to build the resulting production commit.
6. Confirm the production deployment commit is the expected merged candidate lineage.
7. Run the production smoke test immediately.

Do not promote an unverified older preview simply because it is READY.

## Production smoke test

Immediately after production becomes READY:

- [ ] Signed-out `/` shows login and no farm data.
- [ ] Owner can sign in and load the purple homepage.
- [ ] Anna can sign in and load the same shared homepage.
- [ ] Home task cards load.
- [ ] Day, Week, Month, Mowing, and Weeding load.
- [ ] Zone Registry and one object page load.
- [ ] Production plans load for both Owner and Anna with role-appropriate controls.
- [ ] One non-destructive read of germination history succeeds.
- [ ] No unexplained production `500` errors appear in runtime logs.

## Rollback plan

### Application rollback

Record before merge:

- Current production deployment ID:
- Current production commit SHA:
- Current production URL/alias target:
- Candidate production deployment ID:
- Candidate production commit SHA:

If the new application deployment is broken:

1. Stop further task mutations while impact is assessed.
2. Use Vercel rollback or restore the previous production alias to the recorded known-good deployment.
3. Confirm `atlas.elmfarm.co` resolves to the known-good deployment.
4. Re-run signed-out, Owner-login, and Anna-login smoke tests.
5. Record the failure and do not re-release until a new exact-head preview passes.

### Database rollback boundary

The database migrations required by PR #43 are already live, additive, and used by the currently tested branch. Rolling back the Vercel application does not undo Supabase migrations.

Do not automatically reverse database functions or grants during an application rollback. Any database reversal requires a separately reviewed forward migration after checking dependencies and current production usage.

### Data mutation incident

If a release defect writes incorrect task outcomes, dates, assignments, logs, or production states:

1. Stop the affected workflow.
2. Preserve task IDs, actor IDs, timestamps, transition keys, request IDs, and relevant runtime logs.
3. Use the canonical task-result and integrity records to determine the exact affected rows.
4. Repair through an explicit audited migration or supported application transition—never by deleting history casually.

## Release decision

Mark exactly one:

- [ ] `HOLD` — exact-head preview, environment parity, Anna acceptance, or rollback evidence is incomplete.
- [ ] `READY FOR MERGE REVIEW` — every predeployment requirement above passed.
- [ ] `DEPLOYED AND VERIFIED` — production is READY and the smoke test passed.
- [ ] `ROLLED BACK` — production was restored to the recorded known-good deployment and the incident is documented.
