# Clock + Day smart rail, unlock consequence, and Clock-first scheduler contract

Status: design contract for the Owner Clock + Day Editor and the production behavior it is intended to preserve. The editor remains fixture-only until a separate production hookup is approved.

## 1. One smart rail, three truths

The compact rail is one geometric timeline with three independent layers:

1. **Day Clearance Frontier** — the earned chronological progress fill.
2. **Current time** — the larger outlined NOW marker.
3. **Clock placement distribution** — one faint filled dot for every task Clock has placed into the day.

The fill is not `completed task count / total task count`, and the NOW marker is not the end of the fill.

The approved surface does **not** repeat `6 of 11 finished`, `11 tasks · 6 done`, or an internal window countdown beside this rail. The rail must carry the progress concept without duplicating raw counts around it.

### Dot geometry

The progress rail is deliberately a hairline. Ordinary task-placement dots are visibly larger than the rail and sit over it as events. They are neutral/faint. The NOW marker is larger still and is the only purple event marker on the rail.

## 2. Shared linear day coordinate for the compact rail

Given the governed Clock day span `[day_start, day_end]`, normalize any timestamp `t` as:

`x(t) = clamp((t - day_start) / (day_end - day_start), 0, 1)`

Production rules:

- `day_start` and `day_end` come from governed Clock/day-shape truth.
- NOW is `x(current_time)` in the service-day timezone.
- A task dot is `x(clock_placement_start)` for the placement Clock is actually presenting.
- Nearby task dots may visually cluster, but source times stay exact.
- Clock view, Day view, and the smart rail all use the same scheduled task identities.

The compact rail remains **linear in real time** even though the large Clock view uses focus + context compression.

## 3. Smart progress: weighted chronological clearance frontier

A later task completed early must not make Atlas claim the day is cleared through that later time while earlier scheduled work remains unresolved.

For each placed task `i`:

- `x_i` = normalized placement position.
- `c_i` = `1` when canonically completed, otherwise `0`.
- `w_i` = governed expected-work weight. Prefer expected minutes/capacity when known; otherwise use a neutral unit weight rather than inventing minutes.

For candidate frontier `f`:

`M(f) = Σ w_i` for every `i` where `x_i <= f`.

Unresolved prefix debt:

`D(f) = Σ [w_i * (1 + λ * (f - x_i)^γ)]`

for unfinished tasks where `x_i <= f`.

Prefix clearance:

`Q(f) = 1 - D(f) / M(f)`

The Day Clearance Frontier is:

`F = max { f | Q(f) >= τ }`

Candidate points come from the day start and real task placements.

If three morning tasks remain open while an 8 PM task was completed early, those morning tasks remain in `D(8 PM)`. The later completion cannot erase earlier chronological debt.

A structured hard blocker may impose a stricter ceiling. Blocker logic must come from governed dependency truth, never display prose.

## 4. Day-summary visual direction

The approved summary should feel closer to ordinary Atlas than to a prototype dashboard:

- mostly white / very lightly neutral surface;
- restrained Atlas-purple accents rather than a large lavender field;
- thin smart rail with neutral task dots and a purple NOW marker;
- a subtle divider;
- one robust unlock consequence beneath it.

The summary does not show a second progress count or `WINDOW 00:18`.

## 5. Consequence selector

The selector answers:

**What unfinished work matters most because leaving it undone has a real downstream consequence?**

It is independent from NOW and independent from inspection focus.

Eligible evidence includes:

- dependency/unlock edges;
- hard dates or fixed events;
- readiness/release gates;
- resource/session cascades;
- other explicit structured consequence relationships.

A possible ranking family is:

`score_i = severity_i * imminence_i * (1 + lateness_i) * (1 + log(1 + downstream_weight_i))`

Exact factors must be governed and testable.

## 6. UNLOCKS is the presentation grammar

The product vocabulary is **UNLOCKS**, not `Holding`.

The consequence surface should show:

1. the unresolved source task clearly and without truncation where practical;
2. an explicit branch/connector;
3. a prominent `UNLOCKS` label;
4. the full downstream task/event name, allowed to wrap to multiple lines;
5. additional governed unlock targets as branches when they exist.

The fixture example is:

- source: `TIDY · Farmhouse` / `Still open`;
- relationship: `UNLOCKS`;
- target: `Thursday Ticketed Night · Aug 27`.

`MISSED WINDOW` is not the primary consequence badge and is removed from this study. If a future compact fact occupies that visual role, it must explain the consequence itself, such as `EVENT TOMORROW`, `2 UNLOCKS`, or `BLOCKS 1 EVENT`, and must be derived from structured truth.

If no unfinished task has a governed consequence, the consequence area is absent.

## 7. Clock and Day are two views of one scheduled day

- **Clock** is the default orientation/scheduler view.
- **Day** is the alternate detailed rail/list view.

The toggle belongs in the date header where the old task-count block sat. It must not consume a separate horizontal row below the summary.

Conceptually:

`governed task truth + day shape + constraints -> Clock choreography -> { Clock view, Day view, smart rail }`

Clock and Day never maintain separate task order truth.

## 8. Clock owns fitting flexible work

A task does not need to originate with an exact clock time to receive one in Clock.

Task/source truth says what must be done and carries hard dates, windows, duration, dependencies, resources, route/location, and other constraints. Clock choreography says where Atlas has fitted that executable work into this particular day.

Clock fitting should consider, as governed inputs become available:

- fixed starts and reservations;
- allowed/preferred windows;
- expected duration/capacity;
- dependencies/unlocks;
- equipment/resource recovery;
- route/place efficiency;
- worker day shape and occupied life time;
- existing placements;
- lateness and consequence severity.

There is no worker-facing flexible/unplanned pocket. If admitted work cannot be lawfully fitted, that is a **planning conflict** for governed resolution.

## 9. Clock is a bounded instrument

Clock does not borrow the page/document scroll and it does not become a long Google-Calendar column.

The phone/app shell keeps its normal stable chrome. Inside the Clock surface:

1. the Clock header and `Return to now` control form the stable top edge;
2. the **scrubber begins immediately below that header**;
3. only gestures inside that scrubber change temporal inspection;
4. the scrubber itself has a bounded height and never makes the entire Atlas page move merely to inspect another task;
5. first and last scheduled tasks remain represented inside the bounded scrubber at the same time.

Required conceptual ownership:

`screen = stable Atlas chrome + stable day context + bounded Clock scrubber`

`clock_scroll_owner = bounded_scrubber`

A wheel, swipe, arrow key, or direct task tap inside the scrubber changes the inspected focus. It does not mutate task truth.

This is intentionally a focus + context instrument rather than a conventional overflow list.

## 10. Purple means factual NOW

Purple has a narrow meaning in Clock:

- the task Clock says is actually NOW may use the purple task treatment;
- the factual NOW marker is purple;
- merely scrubbing to or inspecting another task must not turn that task purple.

A non-NOW inspected task may become larger, darker, sharper, or receive neutral emphasis, but it remains neutral.

The same rule applies in the alternate Day rail: inspection emphasis is neutral; actual NOW may remain purple.

## 11. Focus + context zoom geometry

The large Clock must preserve the whole scheduled-day context while giving more resolution to the region under inspection.

Every scheduled task receives a positive visual allocation. A simple admissible family is:

`z_i = z_floor + A / (1 + α * |i - f|^p)`

where:

- `i` is the task's chronological index;
- `f` is the current inspected/focus index;
- `z_floor > 0` guarantees distant tasks remain represented;
- `A`, `α`, and `p` tune the lens shape.

Normalize the allocations into the available scrubber height:

`h_i = H_available * z_i / Σ z_j`

The important law is not the exact equation. It is this:

**focus may gain space only by compressing context, never by deleting the beginning or end of the scheduled day.**

Initial focus is the factual NOW task when one exists. When the user scrubs away, the inspection lens moves; factual NOW remains independently marked in purple wherever it sits.

### Detail tiers

Focus + context also controls information density:

- **focus** — full task identity plus useful place/amount detail;
- **near** — time, family, and strong task title;
- **context** — compact time/title representation sufficient to preserve identity and chronology.

This follows the same zoom discipline used by Chronicle: the object remains part of the instrument while the amount of label/detail changes with visual scale. Do not use zoom as permission to fabricate or discard task truth.

For very dense days, context rows may become tiny marks/short labels, but the first and last scheduled tasks must remain visibly represented and reachable by the scrubber.

## 12. Time geometry remains truthful without literal empty space

The bounded lens does not assign equal pixels to equal minutes. A two-hour empty gap therefore does not consume two hours' worth of screen height.

Actual Clock times remain explicit text. Chronological order is invariant. Governed duration remains task truth even when a context row is visually compressed.

Important consequence: **pixel distance and row height inside the bounded lens are not authoritative elapsed time.** Printed Clock times and governed placements are authoritative. The compact smart rail remains the linear real-time overview.

If Atlas later needs gap magnitude inside the lens, it may show a small factual gap label rather than expanding dead space.

## 13. Scrubber / inspection behavior

At initial open:

- inspected focus = NOW task when one exists;
- the NOW task is purple and receives focus-scale detail;
- every earlier and later task remains represented inside the scrubber, including first and last.

When the user scrubs away:

- the inspection focus moves one chronological region at a time;
- the focused task enlarges/sharpens neutrally unless it is also NOW;
- neighboring tasks receive intermediate scale;
- distant tasks compress but stay visible;
- NOW remains factual and purple wherever it actually sits;
- `Return to now` resets the focus lens to NOW without changing schedule state.

Thus `inspected_task_id` and `now_task_id` remain independent.

Scroll/swipe handling must be captured by the scrubber itself so the surrounding Clock screen does not drift during temporal inspection.

## 14. Clock ↔ Day inspection identity

Required identity rule:

`clock.inspected_task_id == day_feed.inspected_task_id`

If the user inspects a task in Clock and switches to Day, the same task remains identifiable. The styling may differ because Clock and Day have different jobs.

## 15. Adjacent-day navigation

Yesterday and tomorrow navigation must exist at **both the top and bottom** of the day surface.

In the bounded Clock composition these controls should remain outside the scrubber. Moving the scrubber focus never changes service date.

Navigation changes the selected farm/service date only; it must not manufacture carryover or rewrite task dates.

## 16. Global exit/back rule

Every ordinary Atlas page except Home should expose a deterministic global exit control in the same header action position currently used by the yellow document `+`.

Approved shell behavior:

- Home keeps the yellow document `+` when the member may document work;
- non-Home routes show a yellow `×` exit control;
- Task Focus honors its existing safe `returnTo` destination when available;
- top-level operational destinations exit to Home;
- More subpages exit to More;
- the More root exits to Home;
- the control uses a governed parent destination rather than blindly depending on browser-history order.

This must be implemented once in the shared Atlas shell, not as per-page back-button hacks.

## 17. Fixture-only values

The Owner editor uses specimen values such as 4:06 PM, a 43% clearance frontier, Sweet William, MG11, BB10, and Thursday Ticketed Night. Atlas-fit times are fixtures demonstrating the scheduling contract. Production wiring must replace them with canonical task, Clock placement, result, dependency, day-shape, reservation, and consequence truth.

## 18. Silent-intelligence admission law

Clock + Day should become simpler on the surface as Atlas becomes smarter underneath.

For every new piece of intelligence, ask first:

**Can this make the schedule better without adding anything to the screen?**

Only information the worker needs to understand, choose, or execute the next move earns pixels.

Study 14 therefore gives each fixture task a hidden intelligence packet and lets one shared ranking function decide which tiny signal, if any, is visible. Task families do not get their own unbounded Clock metadata areas.

Conceptually:

`rich task intelligence -> rank by worker significance -> admit <= tiny visual budget -> Clock`

The target is a Clock that behaves like a compiled version of the day rather than a dashboard exposing every reasoning input.

## 19. Checklist completion becomes task-health truth

Real checklist/child completion must project as one cross-view task-health signal rather than a Clock-specific checklist.

Examples:

- `5/6`
- `3 of 5 zones`
- `6 of 8 beds`

The same child-state truth must be available to Clock, Day, Task Focus, Manager, migration logic, and choreography.

Visual rule:

- distant context may show only the tiny ratio;
- near focus may show one readable progress fact;
- focused/NOW work may show the full compact task-health phrase;
- the checklist itself remains in the canonical Task Card / execution surface.

Remaining task burden may later influence Clock placement, but Study 14 only mocks the presentation output.

## 20. One task, many role projections

A manager choosing `Mine` versus `Team` changes **projection scope**, not task identity.

Required law:

`task_id is invariant across Clock, Day, Task Focus, Manager, Mine, Team, and person-scoped projections`

Hiding a team member from the manager feed must not unschedule, clone, reassign, or otherwise mutate that person's task.

Study 14 demonstrates this by filtering the same fixture task objects through a manager scope control. Team actor identity is deliberately tiny and is suppressed at distant context scale.

## 21. Occupied Time is not a task

Clock needs a generic representation of time already committed, unavailable, or constrained without turning every reservation into task work.

Examples include meetings, travel, delivery windows, appointments, service periods, room bookings, training, machine downtime, calls, inspections, and similar commitments.

Required distinction:

`occupied_time != task`

Occupied Time participates in day geometry and may constrain choreography. It must not inherit task completion semantics, task result controls, or task identity merely because it appears in Clock.

Study 14 renders occupied time as a small neutral temporal span between task rows and a neutral row in Day.

## 22. Work Context generalizes route intelligence

Atlas should reason about context-switching cost rather than hard-code farm routing as the only optimization.

A Work Context may be physical place, customer/account, project, equipment/setup, workstation, team, role, production station, cognitive mode, security state, or other company-specific execution context.

Clock may prefer sequences that reduce expensive context transitions.

The default visual behavior is **no extra UI**. Better ordering is the primary output. Context only earns a tiny signal when the worker materially benefits from knowing it.

## 23. Work Lifecycle / Expected State Progression

Crop lifecycle is one instance of a company-agnostic lifecycle engine.

Given last known state, elapsed time, governing rules, known events, and no contradictory evidence, Atlas should be able to derive an expected next state and the work implied by that state.

Examples include:

- lead -> contacted -> follow-up due;
- draft -> edit -> proof -> approval;
- installed -> inspection due -> service due;
- invoice -> reminder due -> overdue -> escalation;
- applicant -> interview -> decision -> onboarding;
- planted -> growing -> harvestable -> exhausted.

Clock should usually display only the work produced by lifecycle truth. If a reason materially helps the worker, one tiny cue such as `FOLLOW-UP DUE`, `EVENT TOMORROW`, or `HARVEST WINDOW` may be admitted.

## 24. Operating Conditions are scheduling pressure, not a dashboard

Weather is one member of a broader Operating Conditions primitive.

Condition sources may include traffic, business hours, staffing, inventory arrival, machine availability, room availability, system load/uptime, market hours, daylight, temperature, customer presence, regulatory windows, production load, connectivity, and similar external or internal states.

Conditions should eventually support three pressure classes:

- **hard** — impossible/forbidden now;
- **preferred** — better during this condition/window;
- **avoid** — possible but undesirable.

The default visual output is nothing. When the reason matters to execution, a tiny cue such as `BUSINESS HOURS`, `LOW WIND`, `LOW TRAFFIC`, or `CUSTOMER ON SITE` may be shown.

## 25. Progressive Task Signal has a hard visual budget

Clock must never become a miniature Task Card gallery.

A task may have many useful facts, but Clock admits at most the smallest facts that materially change understanding of:

1. progress;
2. readiness;
3. consequence;
4. execution context.

Study 14 uses ranked fixture signals. Context scale admits only a tiny progress/readiness cue when one exists. Near focus admits one signal. Focus admits at most two secondary signals, with a full UNLOCKS branch replacing duplicate consequence text when necessary.

This is a **shared product contract**, not a per-family suggestion. Specialized task-card detail remains in Task Focus.

## 26. End-of-day migration is adjudication, not rollover

At the governed end of a workday, unresolved work needs a real disposition rather than an automatic midnight copy.

Candidate outcomes include:

- **Carry** — still required and lawfully fit into the next day;
- **Reschedule** — belongs later for governed reasons;
- **Expire** — opportunity no longer exists;
- **Needs management** — Atlas cannot safely decide.

Adjudication may consider task health, consequence paths, lifecycle state, conditions, resources, hard dates/windows, readiness, recurrence identity, and prior migration provenance.

Study 14 exposes a compact **END-OF-DAY PREVIEW** only when the scrubber reaches the final visible task. Those closeout rows are fixture outputs, not live adjudication.

Migration provenance such as `↳ Tue` should remain tiny but available so carried work does not lose history.

## 27. Study 14 stress-test objective

The fixture intentionally combines:

- ten scheduled task identities;
- multiple actors;
- `Mine` and `Team` projections;
- task-health/checklist ratios;
- consequence paths;
- occupied-time spans;
- work-context outputs;
- lifecycle cues;
- operating-condition cues;
- carried-work provenance;
- end-of-day disposition outputs.

The success criterion is not that every fact is visible. It is the opposite:

> Atlas should be able to know all of these things while the worker still experiences a calm Clock that mostly tells them what to do next.
