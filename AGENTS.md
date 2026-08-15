<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Atlas governing architecture

Atlas is becoming a **Principal Operating System**, not a farm-management app with a smarter Owner dashboard.

The governing root is:

`Principal / Life → Household & Family + Feast Guild / Portfolio + Teams / Functions + Money / Treasury + Principal Capacity → Principal Clock`

Farms and Worker Day remain operating subsystems beneath that root.

Hard boundaries:

- Do not default to `Owner = highest-level farm manager` when designing new Owner-facing behavior.
- Do not extend the selected-farm-first Owner Clock as the final Principal experience.
- Keep farm execution truth, Worker Day, crop biology, harvest, readiness, release, dependencies, and operator scheduling trustworthy.
- Household & Family is a protected Principal domain, not farm capacity and not a miscellaneous interruption category.
- A delegated task does **not** become Principal work merely because it is unfinished, blocked, uncertain, or overdue.
- Operator reality crosses upward only through an explicit escalation boundary when Principal authority, judgment, approval, capital, or consequence is actually required.
- At that boundary, translate operator vocabulary into ownership vocabulary. The Principal receives the decision/consequence, not somebody else's task card.
- Protect future preparation and H2/H3 portfolio attention from being erased by H1 operating urgency.
- Principal Clock and farm Clock are different arbitration systems over the same institution. Farm Clock answers what the worker executes now. Principal Clock answers who has earned the right to consume the Principal's attention now.

Current implementation sequence:

1. Finish Harvest to a stable production → harvest → sale → fulfillment truth contract.
2. Stabilize farm execution Clock only as Worker Day needs it.
3. Stop extending the old Owner prioritization path.
4. Build the Principal foundation: Principal context, portfolio units, household, Owner obligations, ClockCandidate, escalation contract, and Principal capacity.
5. Build Principal Clock v1.
6. Add Portfolio Office / Attention / Teams / House Position.
7. Retire old farm-root Owner assumptions after the replacement path proves itself.

# Atlas constitutional worker rule

> **Atlas does not ask the worker to manage work. Atlas quietly manages the work so the worker can steward the world in front of them.**

For farm-hand experiences, treat Atlas as external executive-function scaffolding rather than a task-list UI. The worker should receive one bounded next useful action at a time, report reality, and continue. Atlas owns remembering, prioritizing, sequencing, estimating, rescheduling, dependencies, capacity fit, recovery routing, and work-window fit. Avoid exposing choice, prioritization, rescheduling, or project-management vocabulary to the farm hand when the system can resolve it instead.

Implementation implications:

- Farm hand: present **Your Next Move**, not a menu of competing work.
- Farm management: retain the farm project pool, operational dependencies, ambiguity, capacity conflicts, and planning controls needed to keep the operating unit truthful. Do not confuse this management surface with the future Principal Clock.
- Worker responses report reality: Done, Made progress, Need something, Need lighter work, Farm changed.
- `Need lighter work` is a state signal, not a failure or ordinary reschedule. Preserve the underlying obligation, temporarily reduce activation demand, automatically route another useful move, and surface a concise stewardship signal through the proper management/escalation boundary.
- Prefer execution slices with clear physical boundaries over large ambiguous jobs. Management chooses the thinking; Atlas preserves and sequences it; the farm hand executes the bounded move.
- Treat Anna's established summer outdoor rhythm (morning before about 11 and evening around 7 onward) as a strong prior, not a hard clock rule. The Farm Hand Conveyor should combine that rhythm with current and hourly Elm weather. Pleasant/cloudy conditions may expand the outdoor window; heat, humidity, rain, or storms may contract it earlier. When weather data is unavailable, fall back to the established 11 a.m.–7 p.m. indoor preference without moving due dates.
- Outdoor eligibility belongs to the conveyor, Quick Wins, and recovery routing. Never interrupt indoor time with a tiny outside task merely because its duration is short.
- Prefer stored task metadata such as `work_environment` and `heat_exposure` over text inference when those fields exist.
- Describe completions as changes to farm state when possible, not merely checkbox completion.

# Harvest current milestone

Harvest is the active first milestone under the Principal Operating System direction.

Use `docs/HARVEST_TRUTH_CONTRACT_AUDIT.md` as the current implementation audit for Harvest. In particular:

- preserve Harvest Horizon / Harvest Watch as crop readiness truth;
- do not treat forecast stems as finished inventory;
- do not require ordinary Elm flower harvest to pass through a stem-count stage;
- record physical flower output at bucket-equivalent scale before product preparation or sales decisions;
- do not deepen legacy paths that reassign a worker's operational task to the Owner as a substitute for an escalation contract.
