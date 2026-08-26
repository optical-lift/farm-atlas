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

The compact rail remains **linear in real time** even though the large Clock view is allowed to compress empty visual space.

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

## 9. One page owns vertical scrolling

Clock must not create a nested vertical scroll viewport inside an already scrollable Atlas page.

Required rule:

`page_scroll_owner = document`

The Clock scrubber effect is derived from the scheduled block nearest the viewport focus/center while the ordinary page moves. This prevents a worker from trying to scroll Atlas and accidentally becoming trapped in an inner Clock scroller.

Scrolling changes **inspection presentation only**. It never completes, reschedules, or moves a task.

## 10. Purple means factual NOW

Purple has a narrow meaning in Clock:

- the task Clock says is actually NOW may use the purple task treatment;
- the factual NOW line/marker is purple;
- merely scrolling past or inspecting another task must not turn that task purple.

A non-NOW inspected task may become larger, darker, sharper, or receive neutral emphasis, but it remains neutral.

The same rule applies in the alternate Day rail: inspection emphasis is neutral; actual NOW may remain purple.

## 11. Calendar-shaped, elastically compressed time

The first plain Clock proved that literal Google-Calendar spacing wastes too much mobile space. The approved next study keeps calendar semantics without giving every real-world minute equal screen height.

Actual Clock times remain explicit text. Order remains chronological. Task duration remains visually meaningful. Empty gaps are compressed by a monotonic function such as:

`G(g) = clamp(g_min + k * sqrt(g), g_min, g_max)`

or another governed/tuned monotonic compression.

Task visual height may similarly use a bounded monotonic duration function such as:

`H(d) = clamp(h_min + k_d * log(1 + d), h_min, h_max)`

Important consequence: **pixel distance in the large Clock is not itself authoritative elapsed time.** Printed Clock times and governed placements are authoritative. The compact smart rail remains the linear real-time overview.

Long gaps may show a tiny duration cue (`1h 45m`) so the compression is legible instead of deceptive.

## 12. Scrubber / inspection behavior on the page

At or near NOW, the actual NOW task is visually dominant and purple.

When the user scrolls away:

- the scheduled task nearest the viewport focus becomes the inspected task;
- that inspected task enlarges/sharpens neutrally;
- NOW remains factual and purple wherever it actually sits;
- a `Return to now` action may scroll the document back to the NOW task;
- no separate inner-scroll gesture exists.

Thus `inspected_task_id` and `now_task_id` remain independent.

## 13. Clock ↔ Day inspection identity

Required identity rule:

`clock.inspected_task_id == day_feed.inspected_task_id`

If the user inspects a task in Clock and switches to Day, the same task remains identifiable. The styling may differ because Clock and Day have different jobs.

## 14. Adjacent-day navigation

Yesterday and tomorrow navigation must exist at **both the top and bottom** of the day surface.

Top navigation lets a worker browse dates before entering the day. Bottom navigation prevents forcing the worker to scroll all the way back to the top after finishing or inspecting the current date.

Navigation changes the selected farm/service date only; it must not manufacture carryover or rewrite task dates.

## 15. Global exit/back rule

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

## 16. Fixture-only values

The Owner editor uses specimen values such as 4:06 PM, a 43% clearance frontier, Sweet William, MG11, BB10, and Thursday Ticketed Night. Atlas-fit times are fixtures demonstrating the scheduling contract. Production wiring must replace them with canonical task, Clock placement, result, dependency, day-shape, reservation, and consequence truth.
