<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Atlas governance hierarchy

Before making foundational changes to identity, authority, custody, communication, synchronization, persistence, infrastructure, device assumptions, world-model semantics, or Principal arbitration, read `docs/governance/README.md` and the governing documents it points to.

Authority order:

1. observed reality;
2. `docs/governance/constitution.md`;
3. `docs/governance/continuity-horizon.md`;
4. governing premises;
5. canon;
6. ADRs;
7. implementation.

A lower layer may not silently redefine a higher one.

For substantial foundational work, explicitly answer:

> **Which constitutional invariants does this touch, and which future capabilities does it constrain?**

If a change establishes or reverses a durable architectural choice, record an ADR using `docs/governance/decisions/ADR-TEMPLATE.md`.

Do not encode a provider, current UI, cloud host, phone number, email address, authentication record, or device as a deeper Atlas identity merely because it is convenient for the present implementation.

# Atlas constitutional product rule

> **Atlas does not ask the worker to manage work. Atlas quietly manages the work so the worker can steward the world in front of them.**

For farm-hand experiences, treat Atlas as external executive-function scaffolding rather than a task-list UI. The worker should receive one bounded next useful action at a time, report reality, and continue. Atlas owns remembering, prioritizing, sequencing, estimating, rescheduling, dependencies, capacity fit, recovery routing, and work-window fit. Avoid exposing choice, prioritization, rescheduling, or project-management vocabulary to the farm hand when the system can resolve it instead.

Implementation implications:
- Farm hand: present **Your Next Move**, not a menu of competing work.
- Owner/manager: retain the full project pool, queue, dependencies, ambiguity, and planning controls.
- Worker responses report reality: Done, Made progress, Need something, Need lighter work, Farm changed.
- `Need lighter work` is a state signal, not a failure or ordinary reschedule. Preserve the underlying obligation, temporarily reduce activation demand, automatically route another useful move, and surface a concise stewardship signal to the Owner.
- Prefer execution slices with clear physical boundaries over large ambiguous jobs. The Owner chooses the thinking; Atlas preserves and sequences it; the farm hand executes the bounded move.
- Treat Anna's established summer outdoor rhythm (morning before about 11 and evening around 7 onward) as a strong prior, not a hard clock rule. The Farm Hand Conveyor should combine that rhythm with current and hourly Elm weather. Pleasant/cloudy conditions may expand the outdoor window; heat, humidity, rain, or storms may contract it earlier. When weather data is unavailable, fall back to the established 11 a.m.–7 p.m. indoor preference without moving due dates.
- Outdoor eligibility belongs to the conveyor, Quick Wins, and recovery routing. Never interrupt indoor time with a tiny outside task merely because its duration is short.
- Prefer stored task metadata such as `work_environment` and `heat_exposure` over text inference when those fields exist.
- Describe completions as changes to farm state when possible, not merely checkbox completion.

## Worker task epistemic release rule

A worker-facing task is an execution warrant, not an unresolved research note. Only resolved execution facts may cross into `assigned_worker` work.

If any fact required to execute the task correctly is unknown — including method, material or product identity, resource or equipment, amount or dilution, safety constraint, destination, timing or work window, prerequisite, or another execution-critical condition — stop authoring/release and return that unknown to Owner custody or the canonical truth-acquisition path. Ask for the missing fact rather than guessing, substituting, or encoding uncertainty into the worker card.

Never emit worker-facing placeholders such as `TBD`, `method resource not attached`, `do not infer product`, `owner must define`, or equivalent unresolved language. Do not invent a product, resource, method, dose, safety rule, place, or timing fact to make a task appear complete. The task may become worker-visible only after required truth is resolved and represented through the canonical task/resource/readiness contracts.
