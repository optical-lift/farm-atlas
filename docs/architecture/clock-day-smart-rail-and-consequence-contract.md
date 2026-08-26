# Clock + Day smart rail, consequence row, and temporal scrubber contract

Status: design contract for the fixture-only Owner Clock + Day Editor. This document defines the behavior that production wiring must preserve. It does not authorize the fixture to read or mutate live Worker state.

## 1. One rail, three truths

The compact rail under the date is one geometric timeline with three independent layers:

1. **Earned chronological progress** — the purple fill.
2. **Current time** — the larger outlined NOW dot.
3. **Clock placement distribution** — one faint dot for every task that has an authoritative placement in the day.

The layers share the same horizontal day coordinate but they are not aliases for one another. In particular, the purple fill is not `completed task count / total task count`, and the NOW dot is not the end of the purple fill.

The literal count may still say `6 of 11 finished`; that is a count. The rail fill answers a different question: **how much of the scheduled day has actually been cleared in chronological terms?**

## 2. Day coordinate

Given an authoritative Clock day span `[day_start, day_end]`, normalize any timestamp `t` onto the rail as:

`x(t) = clamp((t - day_start) / (day_end - day_start), 0, 1)`

Production rules:

- `day_start` and `day_end` must come from governed Clock/day-shape truth. Do not invent a generic 7 AM–8 PM span.
- The NOW marker is `x(current_time)` in the service-day timezone.
- A task-placement dot is `x(planned_start_at)` for an authoritative Clock placement.
- An unplaced task receives no fake dot. If Atlas later needs to disclose unplaced work, that is a separate count/state, not a fabricated timeline position.
- Multiple tasks near the same time may visually cluster or slightly stack, but their source positions remain their actual placements.

## 3. Smart progress: weighted chronological clearance frontier

A later task completed early must not make the bar claim that the day has been cleared through that later clock time while earlier scheduled work remains unresolved.

For each placed task `i`:

- `x_i` = normalized placement position.
- `c_i` = `1` when canonically completed, otherwise `0`.
- `w_i` = governed expected-work weight. Prefer canonical expected minutes/capacity weight when available. When no governed duration exists, use a neutral unit weight; do not invent minutes.

For a candidate frontier `f`, define the scheduled work mass at or before it:

`M(f) = Σ w_i` for every `i` where `x_i <= f`.

Define unresolved prefix debt:

`D(f) = Σ [w_i * (1 + λ * (f - x_i)^γ)]`

for every unfinished task `i` where `x_i <= f`.

The age term makes older unresolved work carry more debt than work that has only just slipped. Initial tuning may use `γ = 1`; `λ` and the tolerated debt threshold are policy/tuning values and must not be copied from editor fixture percentages.

Define prefix clearance:

`Q(f) = 1 - D(f) / M(f)`

for `M(f) > 0`.

The **Day Clearance Frontier** is the latest candidate point whose weighted unresolved prefix debt stays within the accepted tolerance:

`F = max { f | Q(f) >= τ }`

Candidate points should come from the day start and actual placement positions, not arbitrary pixel increments.

### Consequence of this definition

Suppose at 4 PM three morning tasks remain open, while an 8 PM task was completed early. Testing a frontier at 8 PM necessarily includes those three older unresolved morning tasks in `D(8 PM)`. The isolated 8 PM completion adds work mass but does not erase that debt, so the frontier does not simply leap to 8 PM.

Conversely, if the worker has genuinely cleared nearly all scheduled work through a later point, the frontier may move ahead of the NOW dot. That is legitimate: Atlas can show that the person is ahead of the clock without pretending that one out-of-order completion cleared the intervening day.

### Hard blocker guard

An unresolved task whose governed consequence explicitly blocks a hard downstream obligation may impose a stricter frontier ceiling according to policy. This must use structured blocker/dependency truth, not prose inference.

## 4. Visual grammar for the rail

The rail should remain one compact element inside the existing Atlas-style day summary:

- pale neutral full-length base line;
- light-purple fill from day start through `F`;
- faint low-contrast placement dots centered on the same line;
- one larger outlined purple NOW dot at `x(current_time)`;
- current-time label attached to the NOW dot;
- literal finished count and active-window countdown may remain adjacent to the rail.

Task dots are distribution marks, not completion badges. Their default visual treatment should remain faint and consistent whether a task is complete or open unless a later approved design explicitly adds another encoding.

The rail should not live in a separate white capsule. The approved visual direction is to preserve the current Atlas Work grammar: the smart rail belongs to the same pale-purple rounded day-summary card that also contains the consequential unfinished-work row.

## 5. Consequence selector

The consequence selector answers:

**What unfinished work matters most because leaving it undone has a real downstream consequence?**

It is not the NOW selector, and it is not necessarily the oldest task.

Eligible candidates must be unresolved and have governed consequence evidence such as:

- a real dependency/unlock edge;
- a hard date or fixed event that is threatened;
- a release/readiness gate being held;
- a resource/session cascade;
- another explicit structured consequence-of-delay relationship.

A production selector may rank candidates using structured severity, lateness, imminence, and downstream breadth. One acceptable family is:

`score_i = severity_i * imminence_i * (1 + lateness_i) * (1 + log(1 + downstream_weight_i))`

The exact factors must be governed and testable. Never manufacture consequence importance from display prose.

## 6. Consequence presentation inside the Atlas day summary

The large two-column scorecard and a second independently boxed consequence card are both rejected for this purpose. The approved direction is the existing Atlas day-summary / carried-move grammar:

- one pale-purple rounded day-summary card;
- finished-count / smart-rail state at the top;
- a subtle divider;
- compact consequence row beneath the divider;
- small state pill on the left;
- strong primary line naming the unresolved task;
- muted secondary line naming the consequence;
- small disclosure caret on the right;
- no duplicated task-count score inside the consequence row.

The pill reflects the task's real state, for example `OVERDUE`, `MISSED WINDOW`, `BLOCKING`, or `AT RISK`; it is not a hardcoded universal label.

Fixture example:

- pill: `MISSED WINDOW`
- primary: `TIDY · Farmhouse still open`
- secondary: `Holding Thursday Ticketed Night · Aug 27`

If there is no unresolved task with a governed consequence, the divider and consequence row should be absent rather than filled with generic overdue work.

## 7. Independent selectors

The Clock + Day surface has at least four independent states:

- **NOW task** — what the Clock says should be happening now;
- **Day Clearance Frontier** — how far the scheduled day is chronologically cleared;
- **Consequence task** — the unresolved task with the most important governed downstream consequence;
- **Inspected task** — the placed task the user is currently examining with the temporal scrubber.

These are allowed to point at different tasks/times. Production must not collapse them into one `activeTask` variable.

## 8. Fixture-only values

The Owner editor currently uses specimen values such as 4:06 PM, 00:18, a 43% clearance frontier, Sweet William, MG11, BB10, and Thursday Ticketed Night. These values are visual fixtures only. Production wiring must replace them with canonical Clock placement, result, dependency, day-shape, and consequence truth.

## 9. Temporal scrubber: why it exists beside the full task feed

The vertical roller is not a second task feed. Its job is **time navigation**.

The regular task feed remains the detailed work surface: task identity, place, quantities, state, dependencies, and task-focus entry all belong there. The scrubber is intentionally information-poor so a person can move quickly through the chronology without reading or manipulating the full records.

The scrubber must therefore behave as a temporal index:

1. It contains only tasks with authoritative Clock placements.
2. Items are ordered by authoritative placement time.
3. The control scrolls vertically and snaps to one task at a time.
4. The centered/snapped task becomes `inspected_task_id` presentation state.
5. Past tasks remain inspectable; future tasks remain inspectable.
6. Completion does not remove a placed task from the scrubber merely because it has passed.
7. Unplaced work does not receive an invented scrubber position.
8. Scrolling the scrubber never mutates a task, changes a Clock placement, changes NOW, or changes the Day Clearance Frontier.

### NOW and inspection must remain visibly different

The actual NOW marker remains factual and fixed to current time on the smart rail. When the user scrolls the scrubber from a 4:06 PM task to a 7:00 PM task, Atlas is **inspecting 7:00 PM**, not claiming that it is 7:00 PM.

At initial load the scrubber may center the actual NOW task when one exists. Once the user scrolls away, the center row represents inspection rather than current time.

## 10. Scrubber ↔ task-feed synchronization

The scrubber earns its place only if it indexes the regular feed rather than duplicating it.

Required identity rule:

`scrubber.inspected_task_id == task_feed.inspected_task_id`

When the user settles the scrubber on a placed task:

- the matching task in the full feed must become visibly inspected/highlighted;
- the full task record remains the authoritative detailed presentation;
- production may bring the matching feed row into view after the scrub gesture settles, but must not steal the ongoing vertical scrub gesture or make continued scrubbing impossible;
- if auto-positioning the full feed cannot be made stable on mobile, visible identity synchronization is mandatory and automatic feed scrolling is optional until the roller can remain usable while the feed moves.

A direct explicit inspection action from the full feed may also update the scrubber to the same task. Passive page scrolling alone should not continually rewrite scrubber inspection state; that would make the two vertical surfaces fight each other.

This is presentation synchronization only. It is not a scheduling or task-state mutation.

## 11. Scrubber placement is still provisional

The interaction contract above is approved for study; the final physical location of the scrubber is not. The Editor may move the scrubber relative to the day-summary card and regular feed without changing its semantic role.

If later testing shows that the scrubber cannot provide faster chronological inspection than the full feed, or cannot synchronize without fighting normal task-feed use, it should be removed rather than retained as a decorative duplicate.
