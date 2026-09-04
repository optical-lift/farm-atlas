<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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

# Atlas reality intake constitutional rule

> **No source, interface, assistant, integration, or domain module may be required to understand Atlas's internal storage topology in order to report reality. Sources report observations through contracts. Atlas alone resolves identity, reconciles governing state, and determines operational consequences.**

The governing architecture is documented in:

- `docs/architecture/atlas-core-reality-contract-v1.md`
- `docs/architecture/atlas-receive-reconciliation-v1.md`
- `docs/architecture/smart-contacts-elm-local-boundary-v1.md`
- `docs/architecture/elm-farm-reality-recovery-plan-v1.md`

Implementation implications:
- Distinguish **evidence**, **event**, and **projection**. Do not use a projection row as the historical ledger.
- Preserve incoming evidence with provenance before promoting it into governing state.
- Prefer explicit correction, cancellation, supersession, and conflict records over destructive history rewrites.
- Canonical identities for people, organizations, places, and relationships belong to Atlas Core.
- Domain systems may specialize Atlas Core identities and events; they may not create a parallel canonical identity/history system.
- Ordinary UI and assistant writes must use Atlas-owned receive or domain contracts. Raw table mutation is for controlled migration, diagnosis, and architecture work only.
- A caller should be able to retrieve `what is going on with this person/organization?` through a canonical relationship timeline/current-position read surface without knowing domain table names.
- Unresolved identity must remain unresolved or enter review. Never guess merely to complete a write.

# Atlas integration identity boundary

> **An integration may enrich Atlas's world but may never own an Atlas entity's identity. Disconnecting an integration must not erase the organization's valid history or relationships.**

Implementation implications:
- External systems attach to Atlas canonical parties through provider/external identity links.
- Do not introduce new Atlas Core foreign keys that make canonical identity depend on an optional integration.
- Treat Smart Contacts / Elm Local as an optional intelligence integration, not an Atlas Core identity store.
- Integration contributions must declare whether they are evidence-only, enrichment, action results, or narrowly authoritative for a specific external state.
- Accepted integration discoveries become Atlas-owned parties/relationships while retaining provider provenance.
- Atlas must remain operational when an optional integration is disconnected or unavailable.

## Worker task epistemic release rule

A worker-facing task is an execution warrant, not an unresolved research note. Only resolved execution facts may cross into `assigned_worker` work.

If any fact required to execute the task correctly is unknown — including method, material or product identity, resource or equipment, amount or dilution, safety constraint, destination, timing or work window, prerequisite, or another execution-critical condition — stop authoring/release and return that unknown to Owner custody or the canonical truth-acquisition path. Ask for the missing fact rather than guessing, substituting, or encoding uncertainty into the worker card.

Never emit worker-facing placeholders such as `TBD`, `method resource not attached`, `do not infer product`, `owner must define`, or equivalent unresolved language. Do not invent a product, resource, method, dose, safety rule, place, or timing fact to make a task appear complete. The task may become worker-visible only after required truth is resolved and represented through the canonical task/resource/readiness contracts.