# Employee Seat — Worker Delivery Generalization, Step 2

Status: implemented read-path boundary, no Worker Day behavior change
Date: 2026-09-07

## Purpose

This step implements the next approved move from the Employee Seat — Generic Worker Surface v1 plan:

> Move Worker Day reading behind `WorkerSessionContext` so the delivery membership stops coming from `ANNA_FARM_MEMBERSHIP_ID` on the real Work Pass path.

This step does not create `/today`, rename the Anna client, generalize the mutation route, alter capability scope, change Worker Day eligibility, or modify database transition law.

## What changed

`lib/worker-delivery.ts` now contains a generic reader:

```ts
getWorkerDelivery(workerContext)
```

The reader selects the Worker Day projection, pilot events, and active attention using:

```text
workerContext.deliveryMembershipId
```

rather than the Anna membership constant.

The existing Worker Day rules remain unchanged:

- current-day rows remain eligible;
- prior rows carry only when `rollover_policy === "carry"`;
- canonical source work completion remains authoritative;
- worker-reported completion remains distinct;
- cancelled/superseded source work remains non-deliverable;
- active attention remains one membership-scoped state;
- unscheduled reported work remains day-scoped.

## Production-history constraint

The current production `worker_week_projection` history predates complete organization-column population. Most historical Anna projection rows do not carry `organization_id` or `organization_membership_id`.

Therefore this step does not add an organization-column filter to the projection query.

Organization/worker binding remains enforced before the read by the already-governed Work Pass/session membrane. The generic delivery reader receives an already-resolved `WorkerSessionContext` and uses its `deliveryMembershipId` to select the worker's projection history without rewriting or hiding historical rows.

## Consumers

### `/anna`

The current `/anna` route remains as the temporary presentation surface.

When a valid Elm Work Pass session exists:

```text
WorkerSessionContext
→ getWorkerDelivery(workerContext)
→ existing Anna presentation
```

When no Work Pass context exists, the old public/pilot compatibility path still calls `getAnnaWorkerDelivery()`.

This fallback is transitional and is not the future employee-seat authority path.

### Existing mutation endpoint

`/api/anna/pilot` is not generalized in this step.

Its delivered-projection safety check now prefers the same session-derived Worker Day read when `WorkerSessionContext` exists. The mutation still executes through the unchanged `worker_delivery_pilot_transition_v1` RPC and the existing pilot session credential.

## Compatibility adapter

`getAnnaWorkerDelivery()` remains temporarily as:

```text
prototype route compatibility
→ generic internal loader
→ Anna membership constant
```

It is not used as the authoritative Work Pass read when a resolved worker context is present.

## What deliberately did not change

- `/anna` route
- `/today`
- `AnnaWorkerDayClient`
- `/api/anna/pilot` route name
- `worker_delivery_pilot_transition_v1`
- Work Pass scope
- capability redemption rules
- session-status RPC
- Worker Day eligibility semantics
- completion semantics
- attention semantics
- database schema
- Personal Atlas authentication
- owner/manager `/work` namespace

## Governing invariant after Step 2

For a real Work Pass session:

```text
route
≠ worker identity

WorkerSessionContext.deliveryMembershipId
→ Worker Day read identity
```

The next approved step can create the generic `/today` Encounter Form using this existing context-driven read. It should not need to introduce a new Worker Day data-selection rule.
