# Atlas Governance

This directory governs foundational Atlas product and architecture decisions.

It exists to preserve what Atlas is while allowing implementation to change aggressively.

## Authority order

When two documents conflict, use this order:

1. **Reality** — observed truth outranks every Atlas document.
2. **Constitution** — foundational invariants that must not change accidentally.
3. **Continuity Horizon** — futures the present build must not casually foreclose.
4. **Premises** — governing product orientations that explain what Atlas is trying to make possible and why.
5. **Canon** — current precise meanings of Atlas concepts and relationships.
6. **Architecture Decision Records (ADRs)** — current implementation choices made under the layers above.
7. **Implementation** — code, schemas, infrastructure, interfaces, providers, and deployment details.

A lower layer may not silently redefine a higher one.

## Required question for foundational work

Every substantial proposal or change to identity, authority, custody, communication, synchronization, persistence, infrastructure, device assumptions, world-model semantics, or principal arbitration must answer:

> **Which constitutional invariants does this touch, and which future capabilities does it constrain?**

"None" is a valid answer. The purpose is to make hidden assumptions visible before they become architecture.

## Change classes

### Clarification

Improves wording without changing meaning. Normal review.

### Canon revision

Changes the current model while preserving the Constitution. Record the reason and affected concepts.

### Constitutional amendment

Changes a foundational invariant. The amendment must state:

- what Atlas previously believed;
- what reality or discovered requirement makes that belief inadequate;
- the new invariant;
- systems and records affected;
- future capabilities intentionally altered, abandoned, or newly enabled.

The Constitution is not sacred. Reality outranks it. It is deliberately difficult to change only so Atlas does not drift by accident.

## Current structure

- [`constitution.md`](constitution.md) — foundational invariants.
- [`continuity-horizon.md`](continuity-horizon.md) — futures current architecture must keep possible.
- [`premises/`](premises/) — governing product premises.
- [`canon/`](canon/) — canonical meanings and relationships.
- [`decisions/`](decisions/) — ADRs and ADR template.

Executable architectural checks belong beside the code they govern and should cite the constitutional or canonical rule they enforce.