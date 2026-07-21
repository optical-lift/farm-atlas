# Anna Phone Acceptance Walkthrough

## Purpose

This is the final authenticated release gate for PR #43. It verifies that Anna receives the full shared Elm Farm operational app on a phone without receiving Owner mutation powers.

A partial pass is a failed release gate. Do not merge PR #43 until every required item passes or is explicitly repaired and retested.

## Preconditions

- Use a Vercel preview whose deployment commit exactly matches the current PR #43 head.
- Confirm the deployment is `READY`, not a prior successful preview.
- Use Anna's real account and no Owner session, shared cookie, or impersonation extension.
- Prefer Anna's actual phone. A browser viewport near 390 × 844 may be used as a second check, not as a substitute for the real-phone pass.
- Record the preview commit SHA, phone/browser, date, and tester.
- Choose one safe assigned task for mutation testing. Record its original status and date so it can be restored before the walkthrough ends.

## 1. Authentication and shared home

- [ ] Open the preview while signed out. Atlas shows the login experience and no farm data.
- [ ] Sign in as Anna.
- [ ] The first authenticated destination is the shared `/` homepage, not `/work/today`, `/manage`, or a reduced worker portal.
- [ ] The purple Today hero appears without a white or alternate hero flashing over it.
- [ ] The hero shows real task-forward content rather than fixed route categories.
- [ ] The Today header opens the current day overview.
- [ ] The next-day cards open the correct exact dates.
- [ ] Week and Month controls are present and usable.
- [ ] Farm snapshot figures load without an error or empty placeholder.
- [ ] Back navigation returns to the same home scroll position closely enough to continue work.

## 2. Day, Week, and Month continuity

- [ ] Open Day from the purple hero.
- [ ] Day shows the exact selected date.
- [ ] Day does not show the removed task-progress bar.
- [ ] Day task counts reflect tasks due on that date rather than tomorrow's work or an unexplained carryover total.
- [ ] Open Week and confirm task cards are real linked tasks.
- [ ] Open Month and confirm dated tasks appear in the correct date group.
- [ ] Open a task from each view, then use Back. The user returns to the originating date/view rather than being dumped onto another role home.

## 3. Mowing and Weeding collections

- [ ] Day includes a Mowing collection when visible mowing work exists.
- [ ] Day includes a Weeding collection when visible weeding work exists.
- [ ] Week includes both Mowing and Weeding collections when matching work exists.
- [ ] Open Mowing and confirm the cards match real task records, including due date/status changes made elsewhere.
- [ ] Open Weeding and confirm it is collected across zones rather than fragmented into hardcoded zone commentary.
- [ ] Open one collection task, return, and verify the collection preserves a usable navigation path.

## 4. Zones, beds, objects, and history

- [ ] Open the Zone Registry.
- [ ] Open one zone and one bed/object from that zone.
- [ ] The object page shows the correct stable identity and location rather than only a descriptive paragraph.
- [ ] Open a crop-cycle or planting record connected to that object when available.
- [ ] Open field/activity history and verify dated events are linked to the same object.
- [ ] No page displays Owner assignment, membership, or administrative controls.
- [ ] No page exposes another farm's data or an object outside Elm Farm.

## 5. Germination and production history

- [ ] Open an Anna-assigned germination task, such as `Check germination — Teddy sunflower` if it remains available.
- [ ] Germination history loads and shows its linked sowing/current check context.
- [ ] A management-only germination task is not surfaced as Anna-operable work.
- [ ] Open Production.
- [ ] Active production plans and succession timing are readable.
- [ ] Sowing-task links open the corresponding task when the task is in Anna's visible scope.
- [ ] No plan policy, regeneration, succession-state, move-succession, or rule-to-plan controls are available to Anna.
- [ ] Directly visiting an Owner-only production mutation surface does not reveal usable mutation controls.

## 6. Assigned task mutation pass

Use the designated safe task and restore it before finishing.

### Checklist state

- [ ] Open the task and complete one checklist item.
- [ ] Close and reopen the task. The checklist item remains complete.
- [ ] Reopen the checklist item. The reopened state remains after reload.

### Done

- [ ] Mark the safe assigned task Done.
- [ ] The result persists after reload.
- [ ] The task leaves active collections where appropriate and appears in the relevant completed/history context.
- [ ] No duplicate task or duplicate result is created.

### Unfinished → Tomorrow

- [ ] Restore/reopen the safe task if needed.
- [ ] Choose Unfinished and the familiar Tomorrow action.
- [ ] The task moves to the next Central Time calendar date.
- [ ] The task appears once on the new date and no longer appears as active on the old date.
- [ ] The transition/result history records what happened.

### Blocked

- [ ] Mark the task Blocked with a real test reason.
- [ ] The reason remains visible after reload.
- [ ] The task is not silently treated as completed.

### Rescheduled

- [ ] Reschedule the task to a known test date.
- [ ] The exact selected date persists in Day/Week/Month.
- [ ] No duplicate active engine task is created.

### Restore

- [ ] Return the task to its original status and date.
- [ ] Remove or clearly label temporary acceptance-test notes if the interface supports doing so.
- [ ] Confirm the final task state matches the pre-test record.

## 7. Closeout and field logging

- [ ] Open the field-log drawer from the shared homepage.
- [ ] Confirm the controls are usable as Anna without showing Owner assignment controls.
- [ ] Submit only a real operational log, or cancel without saving when no real log is needed.
- [ ] Open closeout summaries and confirm Day, Week, and Month summaries load.
- [ ] A newly saved real log appears in the appropriate object/zone history.

## 8. Owner-boundary checks

- [ ] Anna cannot assign a task to another membership through an Owner control.
- [ ] Anna cannot invite, revoke, or alter farm memberships.
- [ ] Anna cannot use Owner task-transition RPC behavior on unassigned/Owner-only tasks.
- [ ] Anna cannot change production plan policies, succession generation, or rule templates.
- [ ] Owner-only task titles/content do not appear in Anna's canonical task feed.
- [ ] A copied direct URL to a forbidden operation returns a denial or safe redirect, not a partially rendered management screen.

## 9. Mobile quality checks

- [ ] No horizontal page overflow at normal zoom.
- [ ] Purple hero text and controls do not overlap.
- [ ] Bottom navigation/footer does not cover the final task or action button.
- [ ] Drawers can be opened, scrolled, and closed with one hand.
- [ ] Primary task actions have comfortable touch targets.
- [ ] Long task titles wrap without hiding status, date, or action controls.
- [ ] Loading states do not flash a different role's page.
- [ ] Browser Back and in-app Back behave consistently.

## Evidence record

Record:

- Preview URL:
- PR head SHA:
- Vercel deployment ID:
- Tester:
- Account: Anna / Farm Hand
- Device and OS:
- Browser:
- Date and Central Time:
- Safe test task:
- Original task status/date:
- Final restored task status/date:
- Screenshots captured:
- Failed items and issue links:

## Release decision

Mark exactly one:

- [ ] **PASS — eligible for merge review.** Every required item passed, the safe task was restored, and the tested preview commit matches the PR head.
- [ ] **FAIL — remain draft and unmerged.** One or more required items failed, the preview was stale, or the authenticated Anna pass was not completed.
