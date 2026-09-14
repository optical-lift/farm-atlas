# Employee Work Journal

The Employee Work Journal is the institution-issued execution surface for a person occupying an employee seat. It is not an Atlas notebook, and it does not own operational truth.

## Governing boundary

The journal composes existing institutional truth into one dated employee-facing record:

- organization and operating-unit placement;
- employee seat and position identity when available;
- already-governed work delivery;
- timing and carry state;
- explicit worker-facing guidance;
- completion/result-contract state;
- worker-reported work returned to the institution.

The journal never creates a second task model. Company Work, task/result contracts, domain truth, and scheduling remain authoritative below it.

## Generic contract

`EmployeeWorkJournalDay` is organization-generic. It contains:

- `institution`: organization, operating unit, seat, and position coordinates;
- `date` / `timeZone`;
- ordered `entries`;
- `reportedEntries` returned by the employee;
- `shape`, a derived description of the remaining day.

An `EmployeeWorkJournalEntry` contains presentation-safe execution information only: title, explicit delivery guidance, state, timing, carry state, and completion contract metadata. Domain systems may feed the journal, but the contract does not know what a farm, crop, classroom, customer, or document is.

## Current compatibility adapter

The temporary `/anna` route still locates its delivery lane through the legacy farm Worker Day projection and sends mutations through `/api/anna/pilot`. That compatibility code is allowed to know the legacy domain.

The reusable journal contract, institutional identity resolver, and `EmployeeWorkJournalClient` must not contain Elm-, Anna-, farm-, or crop-specific identity assumptions.

This creates the migration seam for a future generic employee-seat route: replace the legacy delivery adapter and command transport while retaining the same Work Journal contract and surface.

## Day shape

The journal may derive a compact shape-of-day statement from governed delivery facts, such as remaining entries, timed commitments, active work, carried work, and worker-reported additions. It must not invent schedule phases, durations, priorities, or narrative meaning that the underlying work does not establish.

## Guidance disclosure

Only explicit employee-facing delivery guidance may cross into the journal. Canonical operational prose such as `work_items.instructions` remains behind the structured-work disclosure boundary unless separately governed for employee presentation.
