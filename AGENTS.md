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

# Task execution truth gate

> **Unknown required execution data is a blocker, not worker-facing task content.**

Before creating or releasing any worker-executable task, verify every fact the worker needs to execute it safely and unambiguously. This includes, when applicable, the actual product or material, tool/resource, quantity or mixing ratio, application or handling method, destination, physical boundary, and any required safety or timing constraint.

- Never approve or release a worker task containing placeholders such as `method resource not attached`, `do not infer product`, `TBD`, `unknown`, or equivalent unresolved execution language.
- Never infer a missing product, material, resource, ratio, method, destination, or other required execution fact from task wording, a similar task, a UI mockup, or general knowledge.
- Search canonical Atlas data first. If a required fact is still unknown, stop task creation/release and ask the Owner for that fact.
- Preserve the unresolved work as owner-side planning or a blocked dependency if needed, but do not present it as executable worker work until the missing fact is canonically recorded.
- Once supplied, store reusable method/resource truth in the appropriate canonical resource or requirement contract and let tasks reference it rather than duplicating or improvising instructions.
