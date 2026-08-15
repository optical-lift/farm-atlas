# Atlas Owner Portfolio Operating System v1

Status: canonical architecture direction for the Owner experience

Supersedes, for Owner-root semantics, the farm-root assumptions in `atlas-phase-b-next-owner-data-slice.md` and the current `OwnerDashboardProjection`. It does **not** replace Farm Hand / Worker Day execution architecture.

## 1. Governing premise

The Atlas Owner portal is not a farm-management dashboard.

It is the operating office for an owner who holds and develops a portfolio of businesses, properties, operating units, programs, future investments, and people.

The root object for Owner is therefore:

```text
Organization / Portfolio
  -> portfolio units / holdings / ventures
    -> businesses / farms / properties / programs
      -> functions / teams
        -> projects / initiatives / operations
          -> delegated work
```

A farm is one portfolio unit. A worker task is several layers below the Owner's root concern.

The Owner portal exists to preserve portfolio coherence when day-to-day operating pressure is high. It must continuously remember and expose what ownership must still do even when the owner cannot keep the full system in working memory.

## 2. Ownership doctrine

Atlas must distinguish **owner work** from **operator work**.

Owner work includes:

- capital allocation across portfolio units and initiatives;
- cash-flow and liquidity stewardship;
- deciding which businesses, properties, and initiatives deserve more, less, or no further investment;
- setting portfolio roles, investment theses, risk limits, and return/outcome expectations;
- protecting future options before capital is available;
- allocating the owner's own time and attention as scarce capital;
- selecting strategic priorities and preserving them from operational noise;
- governance, decision rights, and escalation thresholds;
- selecting and reviewing leaders / functions / teams;
- reviewing consolidated performance, risk, commitments, and opportunity;
- planning future seasons, businesses, properties, and investments early enough that biological, market, legal, or construction windows are not missed.

Operator work includes routine execution inside a portfolio unit or function. Operator work belongs as low in the hierarchy as lawful accountability permits.

The Owner may inspect operator reality at any time, but operator task volume must never become the prioritization algorithm for the Owner day.

## 3. One institution, multiple operating lenses

Atlas remains one system of truth, but the Owner and Farm Hand consume different projections.

### Farm Hand / Worker Day

Primary question:

> What must I execute now, and what do I need to execute it correctly?

The Worker Day can therefore optimize for readiness, instructions, sequence, materials, blockers, completion, and next work.

### Owner / Portfolio Office

Primary question:

> Where must ownership put capital, attention, authority, or preparation so the whole portfolio remains viable and advances?

The Owner projection optimizes for portfolio allocation, liquidity, strategic obligations, protected time, decisions, exceptions, trajectories, and future readiness.

These projections may reference the same underlying operational state, but they are not the same dashboard with different permissions.

## 4. Portfolio hierarchy

### 4.1 Portfolio

`Feast Guild` is currently the natural organization-level root in Atlas.

The portfolio owns the consolidated view of:

- portfolio units;
- liquid resources and commitments;
- owner time / attention;
- shared teams and functions;
- strategic initiatives;
- opportunities and future options;
- material risks;
- decisions requiring ownership.

### 4.2 Portfolio units

A portfolio unit is anything ownership needs to evaluate as a distinct allocation target or source of return / mission value.

Examples may include:

- Elm Farm;
- Waiting Room Farm;
- a not-yet-acquired third farm;
- a venue or hospitality business line if it needs separate economics and governance;
- a media / marketing property if it becomes independently managed;
- another operating business, property, fund, or strategic option.

A portfolio unit may exist **before ownership has acquired or funded it**. Atlas must be able to hold an option and require planning before cash arrives.

Suggested lifecycle states:

```text
option
incubating
building
operating
growing
harvesting
paused
exiting
exited
```

Suggested portfolio roles:

```text
cash_engine
sustain
build_capacity
growth
strategic_option
mission_asset
harvest
exit_candidate
```

These are portfolio judgments, not project statuses.

### 4.3 Horizons

Every material unit or initiative may be assigned a horizon:

- **H1 — Current engine:** what must operate and produce cash / value now.
- **H2 — Emerging engine:** what is being built into the next meaningful source of cash / value.
- **H3 — Future option:** what must be researched, designed, positioned, or made investment-ready before it becomes an operating business.

Atlas must protect all three horizons concurrently.

The daily Owner system is defective if H1 urgency can indefinitely erase H2 and H3 preparation.

## 5. Teams and functions are real even when they contain one person

Atlas should model business functions according to the work the enterprise requires, not the current headcount.

Examples:

```text
Social Media / Marketing Team
  current operator: Owner

Farm Operations Team
  current farm hand: Anna

Finance / Treasury Function
  current data bridge: ChatGPT Finances + Owner review

Venue Sales Function
  current operator: Owner
```

This preserves the operating structure the business needs before the business can afford specialists.

A team can therefore have:

- a function charter;
- accountable owner / operator;
- one or more Critical Numbers / KPIs;
- required rhythms and deliverables;
- current capacity;
- exceptions requiring Owner intervention;
- delegated work beneath it.

The Owner root should see the function's trajectory and exceptions, not automatically inherit its task list.

## 6. Great Game of Business is an operating-company layer

Great Game concepts are valuable inside Atlas, but they do not define the Owner root.

A function or operating unit may expose:

- Critical Number;
- drivers;
- scoreboard;
- forecast;
- accountable person;
- huddle / review cadence;
- next play.

The Owner portfolio rolls these up as evidence about the health and trajectory of the holding.

Example:

```text
Elm Venue
Critical Number: qualified booking pipeline / booked revenue
Trajectory: below plan
Owner decision required: no
Next review: Thursday
```

That is materially different from filling the Owner homepage with every venue-marketing task.

## 7. Capital is broader than cash

Atlas must model at least four scarce owner-controlled resources:

1. **Cash capital** — money available, committed, requested, and deployed.
2. **Time capital** — the owner's protected hours and the capacity of key people.
3. **Attention capital** — which portfolio questions are receiving or being denied cognitive focus.
4. **Authority capital** — decisions, approvals, relationships, guarantees, permissions, and interventions that only ownership can supply.

Later Atlas may add property, equipment, borrowing capacity, reputation, distribution, audience, and other strategic resources, but the first Owner model must not reduce allocation to money alone.

## 8. Financial stewardship contract

The Owner system must be able to answer, with a known `as_of` timestamp and source coverage:

- What cash / liquid resources are available now?
- What committed outflows are already spoken for?
- What recurring outflows are approaching?
- What inflows have actually posted?
- What inflows are expected but not yet received?
- What is the 30 / 60 / 90-day trajectory under current commitments?
- Which unit is producing cash?
- Which unit is consuming cash?
- Which investments are waiting for capital?
- Which investments should be prepared **before** funding exists?
- What capital requests compete with each other?
- What allocation decision is actually required from the Owner?

### Interim financial source

Until Atlas has a direct financial feed, financial snapshots may be entered from a source adapter such as:

```text
source_type = chatgpt_finances
source_as_of = <timestamp>
coverage = <known linked-account coverage>
confidence / reconciliation_state = <state>
```

The adapter is temporary. The domain model must remain source-agnostic so a future Plaid / bank / accounting / Atlas-native feed can replace it without changing Owner semantics.

No financial number should be presented as live truth without an `as_of` and coverage state.

## 9. Investment thesis and allocation state

Every material portfolio unit should eventually expose an Owner-readable thesis:

```text
why_we_own_or_prepare_this
portfolio_role
horizon
current_state
next_value_creating_milestone
capital_deployed_to_date
capital_committed
capital_requested
cash_contribution_or_burn
owner_time_allocation
primary_risks
expected_return_or_outcome
kill_pause_or_review_conditions
```

Not every field must be numeric. A mission asset or future property may have outcome measures rather than near-term financial return.

Atlas must still force the allocation question:

> Why is this consuming scarce resources, and what must become true next?

## 10. Owner obligations are not ordinary tasks

Some work exists because ownership itself must think, decide, design, prepare, or allocate.

Examples:

- build the 2027 Elm crop rotation;
- design Waiting Room landscaping early enough for September / October overwintering sowing;
- prepare the third-farm plan before acquisition capital exists;
- perform monthly cash and capital review;
- decide whether a business line is receiving more investment;
- recruit or replace a function owner;
- negotiate a material relationship.

These need a first-class `Owner Obligation` concept rather than being treated as miscellaneous Owner tasks.

Suggested obligation fields:

```text
id
organization_id
portfolio_unit_id nullable
initiative_id nullable
obligation_kind
statement
why_owner_only
horizon
not_before
must_begin_by
must_finish_by
window_end nullable
estimated_owner_minutes
cadence nullable
protection_level
state
consequence_if_missed
source / evidence
```

The timing model must support **must begin by**, not only due dates. Strategic work becomes dangerous long before its final due date.

## 11. Owner time is a portfolio allocation

Owner calendar construction must happen in this order:

1. Identify time-bound Owner obligations whose planning / execution window is approaching.
2. Reserve protected strategic blocks based on horizon policy and consequence of delay.
3. Reserve due governance / finance / portfolio-review rhythms.
4. Add decisions and escalations requiring Owner authority.
5. Add unavoidable externally fixed commitments.
6. Only then consider delegated operational work that genuinely requires Owner participation.

Operator task volume must not determine Owner priority.

### Protected blocks

A protected Owner block can be displaced only by an escalation that satisfies an explicit override policy.

Possible override classes:

```text
safety
legal_or_compliance
material_cash_loss
irreversible_biological_window
material_customer_or_reputation_event
owner_authority_blocking_multiple_people
```

Routine incompletion is not automatically an override.

Example:

Anna failing to bundle yesterday's bouquets may create a Farm Operations exception. It should reach the Owner day only if Atlas determines that Owner authority / intervention is required or a material deadline / cash / reputation threshold will be crossed. It must not automatically erase a protected two-hour 2027 crop-rotation planning block.

## 12. Attention debt

Atlas must detect what is becoming invisible because it is quiet.

For every material portfolio unit / horizon / Owner obligation, Atlas should track:

- last meaningful Owner review;
- next required review;
- next irreversible or expensive window;
- planned Owner attention before that window;
- whether protected time exists;
- whether the unit is receiving materially less attention than policy requires.

This produces **attention debt**.

Attention debt is not another inbox. It is a portfolio-level signal that the Owner's resource allocation is drifting.

Examples:

- H3 third-farm plan has not been reviewed in 45 days and no investment-readiness block exists.
- Waiting Room perennial planning window begins in September but no design block exists before seed ordering / sowing decisions.
- Elm 2027 crop plan has a seasonal planning deadline but current Owner calendar contains only H1 operating work.

## 13. Escalation doctrine

Delegation should decrease noise without hiding danger.

A delegated item may escalate to Owner when one or more are true:

- only Owner has authority to resolve it;
- material cash / revenue is at risk;
- a hard external, biological, legal, or customer deadline is at risk;
- repeated failure indicates a capacity / staffing / system problem rather than a one-off task problem;
- the issue crosses an explicit risk threshold;
- the operator has requested a decision within their defined escalation contract;
- the problem threatens a portfolio thesis or milestone.

The escalation must tell the Owner:

```text
what changed
why it matters at Owner level
who currently owns execution
what Atlas tried / what the operator can still do
what decision or resource is required
by when
what happens if Owner does nothing
```

The Owner should not have to reverse-engineer significance from a task title.

## 14. Daily Owner Brief

The Owner home surface should be a **Portfolio Office**, not an exhaustive dashboard.

### 14.1 House Position

Expose the consolidated financial posture first enough that the Owner understands constraint without becoming trapped in fear or account-detail noise.

```text
cash / liquid position as of
committed near-term outflows
posted recent inflows
30 / 60 / 90-day trajectory
material upcoming obligations
financial data coverage / freshness
```

### 14.2 Portfolio Strip

Each material unit gets a compact status:

```text
Unit
portfolio role + horizon
health / thesis state
cash contribution or capital need
next value-creating milestone
next Owner review / action
material risk or decision
```

A future third farm can therefore appear before it is owned:

```text
Farm 3
Strategic Option · H3
Capital: not yet available
Investment-readiness: incomplete
Next owner move: finish acquisition + operating thesis
```

### 14.3 Only You Can Do

This is the highest-value daily action surface.

Atlas selects a small number of Owner moves based on:

- portfolio consequence;
- horizon balance;
- timing windows;
- cash / capital effect;
- dependency unlock;
- owner-only authority;
- attention debt.

This is not simply `ownerActions.today` from the farm task schedule.

### 14.4 Owner Clock

The Clock displays protected ownership allocations alongside fixed commitments and true escalations.

Example:

```text
09:00  Cash / commitments review            GOVERNANCE
10:00  Elm — 2027 crop rotation             PROTECTED · H2
13:00  Social Media Team — publishing       H1 OPERATING FUNCTION
15:00  Waiting Room landscape plan          PROTECTED · H2
16:30  Anna escalation review               EXCEPTION, if still required
```

### 14.5 Horizon Watch

Expose quiet future work before it becomes urgent:

```text
H1 — current engines needing stewardship
H2 — builds that need protected progress this week
H3 — options whose preparedness is decaying
```

### 14.6 Teams / Operating Companies

Expose outcomes, Critical Numbers, capacity, and exceptions.

Examples:

```text
Farm Operations — Anna
Execution health: strained
Today: 6 assigned / 1 blocked
Owner intervention: none

Social Media Team — Owner
Publishing cadence: behind
Critical Number: local reach / qualified inquiries
Protected execution block: 13:00
```

The detailed task surface remains available by drill-down.

### 14.7 Bell — Owner Decisions

Bell is the portfolio exception and decision surface.

Bell should contain things such as:

- capital decision required;
- deadline with no lawful plan;
- strategic initiative with missing owner;
- repeated delegated failure now indicating capacity / governance problem;
- project cannot become real because a required resource / bed / budget / authority is absent;
- financial trajectory crossed a policy threshold;
- future planning window is becoming irreversible.

Bell should not become a duplicate to-do list.

### 14.8 Capital at Work / Opportunity Queue

Expose:

- currently funded initiatives;
- requests for incremental capital;
- investments ready but waiting on cash;
- investments **not yet ready** that must be prepared before cash arrives;
- units that should be slowed / paused / killed / exited;
- optional opportunities with review dates.

## 15. Cadence architecture

Atlas should hold the institution together through recurring governance, not rely on the Owner remembering to review everything.

### Daily

- House Position freshness check
- Only You Can Do
- protected Owner time
- true escalations
- horizon-window warnings

### Weekly

- portfolio unit health and next milestone
- H1 / H2 / H3 attention balance
- team / function Critical Numbers and forecasts
- capital requests / commitments
- decisions overdue
- protected time for next week

### Monthly

- actual vs forecast cash flow
- unit-level contribution / burn
- recurring outflow review
- capital deployed vs thesis
- project / initiative portfolio reprioritization
- staffing / capacity constraints

### Quarterly / seasonal

- portfolio-role and thesis review
- continue / accelerate / hold / pause / exit decisions
- future-option readiness
- major crop / property / construction / marketing season planning
- owner time allocation by strategic priority

### Annual

- strategic portfolio plan
- capital allocation envelope
- major acquisition / disposition / development options
- long-range operating capacity
- succession / governance continuity as relevant

## 16. Existing Atlas schema: what can be reused

The current live schema already contains useful portfolio foundations.

### Reuse and promote

- `atlas.organizations` — natural portfolio root.
- `atlas.organization_memberships` — organization-level authority.
- `atlas.farms` — operating-unit subtype / holding currently representing farms.
- `atlas.projects` — already has `organization_id`, nullable `farm_id`, workstream, project kind, portfolio type, reality state, health, milestone, and parent-project structure. This can become the primary initiative layer rather than remaining implicitly farm-centric.
- `atlas.project_targets` — already allows optional farm / place / zone targets.
- `atlas.project_attention_items` — useful as project-level exception evidence, but should not substitute for Owner attention policy.
- existing Worker Day / task / production / maintenance systems — remain operational substrates beneath portfolio units.

### Generalize before using as portfolio primitives

- `atlas.goals` currently requires `farm_id`.
- `atlas.project_goals` currently requires `farm_id`.
- `atlas.owner_week_projection` currently requires `farm_id`.

These constraints encode the old assumption that Owner planning ultimately resolves through a farm. They should not become the basis of Portfolio Office v1 without a deliberate migration / compatibility design.

## 17. New domain capabilities required

Names remain provisional until implementation design, but Atlas needs first-class storage for:

### Portfolio units / theses

Either generalize the existing farm / project model or add a portfolio-unit layer that can represent owned and not-yet-owned units.

Required semantics:

```text
organization
unit identity
unit type
lifecycle state
portfolio role
horizon
thesis
next value milestone
review cadence
risk / exit criteria
```

### Financial snapshots and commitments

```text
source + as_of + coverage
accounts / consolidated position
posted inflows / outflows
commitments
forecast entries
unit / project attribution where known
capital requests
capital allocations
```

### Owner obligations

First-class strategic work with start-by / finish-by windows and protection rules.

### Owner attention policy / reservations

First-class time and review allocations tied to portfolio priorities.

### Escalation policies and events

A durable record of when operating reality crosses an Owner threshold and why.

## 18. Owner projection contract v1

The old Owner projection:

```text
farm
ownerActions
farmBlockers
workerExecution
upcomingDeadlines
```

must be superseded by an organization-rooted contract similar to:

```text
portfolio
asOf
housePosition
portfolioUnits
capitalAtWork
ownerObligations
protectedTime
onlyYouCanDo
horizonWatch
teamScorecards
ownerDecisions
riskAndEscalations
dataFreshness
```

A selected farm becomes a drill-down context, not the authority root.

## 19. Day assembly policy

Pseudo-order:

```text
portfolio_state = read_consolidated_portfolio()
financial_state = read_financial_snapshot_with_coverage()
obligations = evaluate_owner_obligations_and_windows()
attention = evaluate_attention_debt()
rhythms = evaluate_due_governance_cadence()
escalations = evaluate_operator_escalations()

protected = reserve_owner_time(
  obligations,
  attention,
  rhythms,
  portfolio_policy
)

exceptions = admit_escalations_only_when(
  escalation_satisfies_owner_threshold
)

day = compose(
  protected,
  fixed_external_commitments,
  owner_decisions,
  exceptions
)
```

The key invariant:

> The Owner day is assembled from ownership obligations and portfolio policy first. Delegated operational work is admitted by exception, not by default.

## 20. Acceptance tests

### A. Bouquet execution cannot eat strategic planning

Given Anna has incomplete bouquet-bundling work,
and the Owner has a protected two-hour Elm 2027 crop-rotation block,
when bouquet work does not cross an Owner escalation threshold,
then the Owner block remains protected and bouquet work stays in Farm Operations.

### B. Repeated execution failure can escalate as a system problem

Given delegated farm work repeatedly fails in a way that threatens revenue or proves capacity is inadequate,
when the configured threshold is crossed,
then Atlas creates an Owner escalation describing the capacity / governance decision required rather than merely surfacing the repeated task.

### C. Waiting Room preparation surfaces before sowing urgency

Given Waiting Room landscaping requires design / seed decisions before a September / October overwintering sowing window,
when the planning lead-time threshold is reached,
then Atlas creates / activates the Owner obligation and reserves planning time **before** the biological window becomes urgent.

### D. Farm 3 exists before the money

Given acquisition / launch capital for a third farm is unavailable,
when Farm 3 is an approved H3 strategic option,
then Atlas still holds its thesis, readiness requirements, research, milestones, and review cadence and can schedule owner preparation work.

### E. A one-person team is still a team

Given Social Media is a required business function and the Owner is the only current operator,
then Atlas may model Social Media as a team/function with a Critical Number, cadence, capacity, and output expectations without collapsing it into miscellaneous Owner tasks.

### F. Financial claims preserve provenance

Given financial information was reconciled through a temporary ChatGPT Finances adapter,
when Atlas exposes a cash or trajectory figure,
then the figure includes `as_of` and data-coverage state and does not pretend to be fresher or more complete than the source.

### G. H1 cannot starve H2 / H3 invisibly

Given H1 has abundant operating noise,
and H2 / H3 have required review or preparation windows,
when the Owner week is assembled,
then Atlas detects attention debt and protects qualifying strategic time rather than filling all capacity from H1 task pressure.

## 21. Migration posture

Do not rewrite Farm Hand / Worker Day around this architecture.

Do not begin by cosmetically redesigning Owner.

Implementation should proceed from domain authority outward:

1. establish organization-rooted Owner session / portfolio authority;
2. define portfolio-unit and thesis representation, including future options;
3. define Owner obligations + attention / protected-time policy;
4. define financial-source adapter contract and consolidated `as_of` projection;
5. define Owner escalation policy from operational substrates;
6. build `getOwnerPortfolio()` server projection;
7. make Owner home consume that projection;
8. move current farm-centric owner dashboard into Elm / farm drill-down rather than deleting useful operational visibility;
9. generalize farm-bound goal / owner-week primitives only where the new domain requires it;
10. add regression tests for the acceptance cases above.

## 22. Canonical product rule

**The Owner portal is not the place where the farm gets louder. It is the place where the portfolio stays coherent.**

Atlas must preserve enough institutional memory, timing, financial context, delegation, and protected ownership work that the portfolio can keep advancing even when the Owner's immediate attention is being consumed elsewhere.
