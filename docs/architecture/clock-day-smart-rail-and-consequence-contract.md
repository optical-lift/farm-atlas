# Clock + Day execution-neighborhood contract

Status: current design contract for the Owner Clock + Day Editor. Study 15 supersedes the prior bounded all-task scrubber as the preferred Clock direction. The editor remains fixture-only until a separate production hookup is approved.

## 1. Jurisdiction

Atlas surfaces should not all explain the same work.

- **Day / Work** owns the complete current service day.
- **Clock** owns temporal custody: what the worker just finished, what is in hand now, what Atlas intends to hand over next, and the next hard temporal edge.
- **Task Focus** owns execution detail and result capture.
- **Domain rails / task-family views** own downstream meaning, lifecycle context, dependency chains, inventory movement, and other domain-specific explanation.
- **Atlas intelligence** owns the reasoning that decides what becomes the next lawful move.

Clock therefore does not need to reproduce Day, Task Focus, or the domain rails.

Core law:

> **Clock should be smart by exercising intelligence, not by displaying all of Atlas's intelligence.**

## 2. Execution Neighborhood

Clock's primary projection is the **Execution Neighborhood**.

Conceptually:

```text
Living Day + current reality + Clock choreography
                    |
                    v
          Execution Neighborhood
             LAST
             NOW
             NEXT
             THEN
             NEXT HARD EDGE
```

The projection is intentionally small. It is not a complete task feed.

Typical visual priority:

- **LAST** — subdued receipt of the move that just closed.
- **NOW** — largest and clearest move because it owns the worker's hands.
- **NEXT** — strong enough to let the worker anticipate the next handoff.
- **THEN** — small context for one further move when it is useful and lawful.
- **NEXT HARD EDGE** — the nearest immovable or strongly constrained temporal commitment Atlas must respect.

The exact number of future moves may vary. Clock should not invent THEN when the remaining sequence is unresolved.

## 3. The full day survives as one thin linear rail

Clock still needs orientation across the whole day, but the entire day does not need to remain legible as detailed task cards.

The thin full-day rail is the only Clock surface required to represent the complete temporal span.

The rail may show:

- the governed day start and end;
- one faint neutral marker for each placed task;
- neutral solid spans for Occupied Time / reservations;
- the factual current-time marker.

The rail remains linear in real elapsed time.

Given governed day span `[day_start, day_end]`:

`x(t) = clamp((t - day_start) / (day_end - day_start), 0, 1)`

Task marks use their presented Clock placement. Occupied spans use their governed start/end. NOW uses the current service-day time.

## 4. Purple means factual NOW only

Purple keeps one narrow meaning:

- the factual NOW marker on the day rail is purple;
- a task that is actually in hand NOW may use restrained purple treatment;
- NEXT, THEN, importance, consequence, lateness, inspection, or management attention must not borrow purple.

If there is no lawful task to put in hand because Clock has reached a temporal conflict, the rail still has a factual purple NOW marker. Clock must not fabricate a purple task merely to fill the NOW slot.

## 5. Day owns completeness

Study 15 intentionally removes the previous requirement that the first and last detailed task cards remain visible inside the bounded Clock body.

That requirement belonged to an earlier attempt to make Clock both the complete day and the immediate execution lens.

New rule:

> **Day proves membership. Clock proves position.**

If a worker or manager wants every admitted item in the service day, they use Day / Work. Clock may show only the immediate temporal neighborhood while the thin rail preserves whole-day orientation.

## 6. Clock is not a scrubber by default

The previous focus-context scrubber required users to move an inspection lens over every task in the day. Study 15 no longer treats that as Clock's primary job.

Clock does not need a `Return to now` control when the main view itself is anchored to NOW.

Clock does not need wheel/touch/keyboard task scrubbing to expose distant work. Distant work belongs to Day.

A task shown in Clock may eventually open its canonical Task Focus when tapped, but that is navigation to the task's execution surface, not Clock inspection state.

## 7. Silent progression

Normal completion should make Clock feel almost mechanical in the best sense.

When NOW completes:

1. canonical result truth closes or advances the task;
2. Atlas recompiles the remaining lawful choreography;
3. the old NOW may become LAST;
4. the next lawful move becomes NOW;
5. NEXT and THEN are recalculated from current reality;
6. the hard edge remains governed by its own temporal truth.

This is not a blind array shift. Atlas may change the next sequence if readiness, duration, reservations, resources, lifecycle, or other governed inputs changed.

## 8. Silent reflow

When reality changes but Atlas can still lawfully reconcile the day, Clock should usually **change the plan without displaying the scheduling proof**.

Examples:

- the current task runs long;
- a task finishes early;
- a movable task becomes blocked;
- a prerequisite clears;
- a reservation appears;
- travel takes longer than expected;
- resource readiness changes.

If Atlas can still fit the remaining work:

> **The schedule just gets better.**

Study 15's reflow specimen demonstrates a task finishing 25 minutes late. Delivery and weeding move later while the fixed 4:30 pickup remains intact. Clock does not add an explanation badge for route cost, dependency pressure, or lifecycle reasoning.

## 9. Temporal conflict is where Clock earns explanation

Clock should speak when the problem is specifically temporal and can no longer be resolved silently.

Example:

```text
DAY CONFLICT
MG7 needs 45 min.
22 min remain before Pickup at Elm · 4:30 PM.
```

This belongs to Clock because the conflict is about custody of time.

A temporal conflict may expose governed dispositions such as:

- move after the hard edge;
- choose another lawful placement;
- needs manager.

Clock must not invent an impossible placement simply to keep every task assigned a time.

Required law:

> **Unfittable admitted work is a planning conflict, not worker-owned ambiguity.**

## 10. What Clock should not explain

Clock should not become the display home for every reason a task matters.

Examples that normally belong elsewhere:

- detailed dependency or UNLOCKS chains;
- crop or business lifecycle explanation;
- inventory custody;
- multi-step Task Card checklists;
- detailed readiness diagnostics;
- route history;
- migration history;
- full team workload;
- domain-specific pressure audits.

Atlas may use any of those truths to choose or reorder the Execution Neighborhood. The worker sees the consequence primarily as **what became NEXT**.

## 11. Procedural facts versus downstream meaning

This contract aligns with the broader Worker Day rule that compact worker surfaces should keep execution cues procedural rather than dumping downstream consequence metadata into every card.

Clock may show a small detail needed to execute or identify a move, such as:

- destination;
- concise amount;
- governed time range;
- a short result receipt on LAST.

Downstream meaning remains in the canonical task/domain surface unless Clock needs it to explain a temporal conflict.

## 12. Occupied Time and hard edges

Occupied Time is not a task.

`occupied_time != task`

Meetings, pickups, deliveries, appointments, travel windows, room bookings, service periods, machine downtime, and similar commitments may occupy rail geometry without inheriting task completion semantics.

The Execution Neighborhood promotes only the **nearest operationally important hard edge** into a readable card.

A hard edge may be:

- fixed Occupied Time;
- a fixed-start task;
- a governed reservation;
- another temporal commitment Clock is not allowed to casually move through.

## 13. Task identity remains canonical

Clock is a projection of canonical task identity, not an alternate task system.

Required law:

`clock.task_id == day.task_id == task_focus.task_id`

If a task is superseded, Clock follows the canonical replacement rather than preserving a stale local identity.

Changing Clock choreography changes the placement/projection of the canonical task; it must not create a duplicate Clock task.

## 14. Clock owns choreography

Task/source truth says what work is and carries constraints such as:

- hard dates;
- windows;
- expected duration;
- readiness;
- dependencies;
- resources;
- place/context;
- actor;
- lifecycle;
- result state.

Clock choreography answers:

> **Where does executable work fit in this person's actual day now?**

A flexible task does not need to originate with an exact time. Once Atlas admits it into the worker's day, Clock is responsible for a lawful placement or an explicit planning conflict.

There is no worker-facing flexible/unplanned pocket whose real meaning is "you figure out when to do this."

## 15. Intelligence is primarily an ordering input

Atlas may use increasingly sophisticated intelligence without adding more Clock UI.

Examples include:

- Occupied Time;
- readiness;
- resource recovery;
- context-switch cost;
- expected state progression / lifecycle;
- operating conditions;
- dependency pressure;
- consequence severity;
- route efficiency;
- remaining task burden;
- current service-day capacity.

For each new source of intelligence, ask first:

> **Can this make the next move better without adding anything to Clock?**

If yes, keep it behind the scenes.

## 16. Manager Clock should be person-centered, not a blended Team Clock

Study 15 removes the previous `Mine | Team` blended Clock experiment.

The more useful manager question is:

> **What is each person's work currently doing?**

A future Manager Clock may therefore use a person lens such as Anna / Marshall / Me, where selecting a person shows that person's Execution Neighborhood.

Complete multi-person workload remains a Manager/Day concern.

This keeps one person's temporal sequence coherent instead of interleaving several workers into one pseudo-day.

## 17. Bounded screen contract

Clock remains a bounded Atlas surface.

The stable app/header/footer chrome does not drift merely because work advances. Inside the Clock area:

- the date context is stable;
- the full-day rail is stable;
- the Execution Neighborhood is bounded;
- the immediate cards may update when canonical reality or choreography changes.

Clock no longer needs an internal all-task scroll owner because it no longer attempts to render the whole Day feed.

## 18. Three required Study 15 states

The fixture must demonstrate three distinct behaviors.

### A. Normal progression

- one subdued LAST move;
- one dominant factual NOW move;
- NEXT;
- THEN;
- a fixed hard edge;
- full-day rail orientation.

### B. Silent reflow

- the same canonical task identities appear in a changed choreography;
- a task overrun causes movable work to refit;
- the hard edge remains fixed;
- no scheduling-explanation dashboard appears.

### C. Temporal conflict

- the current time is factual even if no lawful task fits NOW;
- an unfitted task is shown as needing placement rather than being assigned an impossible time;
- the hard edge remains fixed;
- Clock exposes the temporal conflict and governed disposition choices.

## 19. Fixture-only boundary

Study 15 uses specimen task IDs and times only.

The Owner editor must not:

- fetch live Worker state;
- call Atlas task-transition APIs;
- mutate tasks;
- change production choreography;
- write completion/results;
- pretend fixture placement is canonical production truth.

A future production hookup should consume the existing Living Day / Clock authority rather than port this fixture data model into production.

## 20. Promotion gate

Do not promote the Study 15 renderer into Worker Clock until it can consume current canonical projections while preserving these laws:

- one canonical task identity;
- Day owns completeness;
- Clock owns temporal position;
- Task Focus owns execution;
- hard reservations remain authoritative;
- NOW remains factual;
- movable work may silently reflow;
- impossible placement becomes a planning conflict;
- hidden Atlas intelligence improves ordering before it earns pixels.

The desired worker experience is:

> "Atlas knew what I had just finished, what I was doing, what came next, and what fixed thing the day was heading toward. When reality changed, it refit the day. It only interrupted me when time genuinely stopped fitting."
