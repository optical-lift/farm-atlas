# Clock + Day smart rail, consequence row, and Clock-first scheduler contract

Status: design contract for the fixture-only Owner Clock + Day Editor. This document defines the behavior that production wiring must preserve. It does not authorize the fixture to read or mutate live Worker state.

## 1. One smart rail, three truths

The compact rail in the Atlas day summary is one geometric timeline with three independent layers:

1. **Earned chronological progress** — the purple fill.
2. **Current time** — the larger outlined NOW marker.
3. **Clock placement distribution** — one faint filled dot for every task Clock has placed into the day.

The layers share the same horizontal day coordinate but they are not aliases for one another. In particular, the purple fill is not `completed task count / total task count`, and the NOW marker is not the end of the purple fill.

The literal count may still say `6 of 11 finished`; that is a count. The rail fill answers a different question: **how much of the scheduled day has actually been cleared in chronological terms?**

### Dot geometry

Task-placement dots must read as events sitting on a timeline, not holes cut into a progress bar. The progress rail is intentionally very thin. Each ordinary task dot is a larger faint filled circle whose diameter visibly overhangs the rail above and below. The NOW marker remains larger still and outlined so current time cannot be confused with an ordinary task placement.

## 2. Shared day coordinate

Given the governed Clock day span `[day_start, day_end]`, normalize any timestamp `t` onto the compact rail as:

`x(t) = clamp((t - day_start) / (day_end - day_start), 0, 1)`

Production rules:

- `day_start` and `day_end` come from governed Clock/day-shape truth. Do not invent a generic workday.
- The NOW marker is `x(current_time)` in the service-day timezone.
- A task-placement dot is `x(clock_placement_start)` for the placement Clock is actually presenting to the worker.
- Several tasks near the same time may visually cluster or slightly stack, but their source placements remain their actual Clock placements.
- The compact rail, the large Clock view, and the Day list must derive task identity from the same scheduled day sequence.

## 3. Smart progress: weighted chronological clearance frontier

A later task completed early must not make the bar claim that the day has been cleared through that later clock time while earlier scheduled work remains unresolved.

For each placed task `i`:

- `x_i` = normalized Clock placement position.
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

Candidate points should come from the day start and actual Clock placement positions, not arbitrary pixel increments.

### Consequence of this definition

Suppose at 4 PM three morning tasks remain open, while an 8 PM task was completed early. Testing a frontier at 8 PM necessarily includes those three older unresolved morning tasks in `D(8 PM)`. The isolated 8 PM completion adds work mass but does not erase that debt, so the frontier does not simply leap to 8 PM.

Conversely, if the worker has genuinely cleared nearly all scheduled work through a later point, the frontier may move ahead of the NOW marker. That is legitimate: Atlas can show that the person is ahead of the clock without pretending that one out-of-order completion cleared the intervening day.

### Hard blocker guard

An unresolved task whose governed consequence explicitly blocks a hard downstream obligation may impose a stricter frontier ceiling according to policy. This must use structured blocker/dependency truth, not prose inference.

## 4. Atlas day-summary presentation

The smart rail stays inside the existing Atlas-style pale-purple day summary:

- finished-count / window state at the top;
- one thin neutral timeline rail;
- light-purple clearance fill from day start through `F`;
- larger faint filled task-placement dots centered over the rail;
- one larger outlined NOW marker at `x(current_time)`;
- a subtle divider;
- the compact consequential unfinished-work row beneath the divider.

The rail must not live in a separate white capsule. The summary should continue to feel like the current Atlas Work day card, with more intelligence added to its existing visual grammar rather than a new dashboard widget inserted inside it.

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

## 6. Consequence presentation

The large two-column scorecard and a second independently boxed consequence card are both rejected. The consequence row belongs inside the pale-purple Atlas day-summary card:

- a small real-state pill such as `OVERDUE`, `MISSED WINDOW`, `BLOCKING`, or `AT RISK`;
- a strong primary line naming the unresolved task;
- a muted secondary line naming the consequence;
- a small disclosure caret;
- no duplicated task-count score inside the consequence row.

Fixture example:

- pill: `MISSED WINDOW`
- primary: `TIDY · Farmhouse still open`
- secondary: `Holding Thursday Ticketed Night · Aug 27`

If there is no unresolved task with a governed consequence, the divider and consequence row should be absent rather than filled with generic overdue work.

## 7. Independent day states

The Clock + Day surface has at least four independent states:

- **NOW task/time** — factual current time and the task Clock says belongs there;
- **Day Clearance Frontier** — how far the scheduled day is chronologically cleared;
- **Consequence task** — the unresolved task with the most important governed downstream consequence;
- **Inspected task/time** — the scheduled task/time the user is currently examining by scrolling Clock.

These are allowed to point at different tasks/times. Production must not collapse them into one `activeTask` variable.

## 8. Clock is the default worker day viewer

The approved direction is now a two-view worker-day surface:

- **Clock** — default. A time-proportional scheduler/day-timer view that answers what fits where in the actual day.
- **Day** — secondary toggle. The whole ordered task rail, optimized for scanning the detailed work records rather than understanding time geometry.

Clock and Day are two projections of the same scheduled day, not independent ordering systems.

Conceptually:

`governed task truth + day shape + constraints -> Clock choreography -> { Clock view, Day view, smart rail }`

The default may later be revisited from real worker use, but the current design hypothesis is that Clock is the primary orientation surface and Day is the alternate full-list inspection surface.

## 9. Clock is allowed to place flexible work

A task does not need to originate with an exact clock time in order to receive one in Clock. This is a core responsibility of Clock, not an exception.

The production distinction is:

- **task/source truth** says what must be done and carries hard dates, real windows, dependencies, mobility, resources, durations, and other execution constraints;
- **Clock choreography truth** says where Atlas has fitted that executable work into this particular day.

For work that enters the worker day without a fixed start, Clock should assign a usable day placement from the lawful space that remains after harder constraints are honored. That assignment is not a fabricated source fact; it is an explicit scheduling output.

Clock fitting should consider the governed inputs that already exist or are later approved, including:

- fixed starts and hard reservations;
- allowed or preferred intraday windows;
- expected duration/capacity weight;
- dependencies and unlock order;
- resource/equipment constraints and recovery time;
- route/place efficiency;
- worker day shape and occupied life time;
- already committed Clock placements;
- consequence severity and lateness where relevant.

### No flexible-unplanned pocket in the worker Clock

The worker-facing Clock should not contain a generic bucket that effectively says “these flexible tasks are yours too; figure out where they go.” If Atlas has admitted the work into that worker day, Clock's job is to fit it.

If Atlas cannot find a lawful placement, that is a **planning conflict**, not an excuse to silently omit the work or invent an impossible time. The conflict must surface for resolution through governed planning/management machinery before the worker is expected to execute the impossible schedule.

A worker-facing Clock time therefore means **this is the current executable choreography Atlas is giving the worker**, not merely a suggestion hidden in the presentation layer.

## 10. Plain calendar first

The first large Clock study should intentionally resemble a simple day-timer / Google Calendar before adding decorative watch-face effects.

Required baseline grammar:

- a vertical time-proportional axis with hour labels and faint horizontal rules;
- task blocks positioned by Clock start time;
- block height related to governed duration when duration is available;
- a factual NOW line that stays at real current time;
- one vertically scrollable viewport over the day;
- the task nearest the scrub focus becomes visually dominant;
- surrounding tasks remain smaller/lighter so chronology is legible without turning the view into the Day list;
- tapping a scheduled block inspects/centers that block;
- task execution controls remain in Task Focus rather than multiplying inside Clock.

Fancy curvature, wheel distortion, perspective, and watch-face styling are deferred until the plain calendar proves the information architecture is clear.

## 11. Calendar scrubber behavior

The scrolling Clock is a time scrubber, but unlike the earlier compact roller it preserves actual time distance between tasks.

At initial open:

- Clock centers the current NOW region/task when possible;
- that task is the enlarged focal block;
- the factual NOW line coincides with real current time.

When the user scrolls away:

- the nearest scheduled task becomes the inspected focal block;
- the header may say `INSPECTING · 7:00 PM`;
- the factual NOW line does not move;
- a `Return to now` action may recenter the real current-time region;
- scrolling/inspection never completes, reschedules, or otherwise mutates a task.

Thus `focused/inspected` and `NOW` remain separate even though they coincide when Clock first opens.

## 12. Clock ↔ Day identity synchronization

Clock and Day must share inspection identity even though only one view is visible at a time.

Required identity rule:

`clock.inspected_task_id == day_feed.inspected_task_id`

If the user inspects a future block in Clock and then toggles to Day, the corresponding Day row should remain visibly identifiable as the inspected task. Toggling views is presentation-only and must not rewrite schedule or task state.

The Day view remains the detailed work surface: task identity, place, quantities, state, dependencies, and Task Focus entry belong there. Clock remains the temporal scheduler/orientation surface.

## 13. Fixture-only values

The Owner editor currently uses specimen values such as 4:06 PM, 00:18, a 43% clearance frontier, Sweet William, MG11, BB10, and Thursday Ticketed Night. Some specimen tasks are marked `atlas-fit` solely to demonstrate the scheduling contract. These values are visual fixtures only. Production wiring must replace them with canonical task, Clock placement, result, dependency, day-shape, reservation, and consequence truth.
