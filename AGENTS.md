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
