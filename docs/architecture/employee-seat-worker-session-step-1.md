# Employee Seat — Worker Session Generalization, Step 1

Status: implemented boundary, no Worker Day behavior change
Date: 2026-09-07

## Purpose

This step implements only the first engineering move from the approved Employee Seat — Generic Worker Surface v1 plan:

> Trace every Anna-specific identity dependency through the live flow, classify it, then introduce a generic `WorkerSessionContext` boundary before building `/today` or generalizing Worker Day presentation.

No new identity model, task model, authority model, routing model, or Worker Day semantics are introduced here.

## Live-flow trace

Current production flow:

`Work Pass redemption`
→ `worker session`
→ `/anna`
→ `getAnnaWorkerDelivery()`
→ `/api/anna/pilot`
→ `worker_delivery_pilot_transition_v1`

### 1. Work Pass redemption

File: `lib/worker-work-pass.ts`

Current Anna-specific elements:

- `ANNA_FARM_MEMBERSHIP_ID`
- `ANNA_ELM_ORGANIZATION_MEMBERSHIP_ID`
- `WORK_SURFACES[Anna membership] -> /anna`

Classification:

- delivery membership UUID: **REAL INSTITUTIONAL DATA** currently embedded as a prototype application constant
- organization membership UUID: **REAL INSTITUTIONAL DATA** currently embedded as a prototype application constant
- `/anna` destination map: **PROTOTYPE APPLICATION CONSTANT**
- capability redemption RPC and identity-binding verification: **SECURITY BOUNDARY — PRESERVE**

This step does not generalize the destination map yet.

### 2. Worker session

Files:

- `lib/anna-worker-day-pilot.ts`
- `lib/worker-session.ts`

Prior state:

The application could validate the session but returned only a Boolean Anna edit state.

Step-1 state:

`lib/worker-session.ts` now resolves a generic server-side context:

```ts
type WorkerSessionContext = {
  organizationMembershipId: string;
  deliveryMembershipId: string;
  organizationId: string;
  institutionalPersonId?: string;
  scope: string;
  expiresAt: string;
};
```

Classification:

- `organizationMembershipId`: **REAL INSTITUTIONAL DATA**
- `deliveryMembershipId`: **REAL INSTITUTIONAL DATA**
- `organizationId`: **REAL INSTITUTIONAL DATA**
- `institutionalPersonId`: planned field, presently unresolved and therefore omitted at runtime
- `scope`: **SECURITY BOUNDARY DATA**; current pilot scope is preserved unchanged
- `expiresAt`: **SECURITY BOUNDARY DATA**

The resolver uses the existing governed session-status RPC and reads the canonical organization membership to obtain `organizationId`.

It does not accept a worker identity from the client.

### 3. `/anna` presentation

File: `app/anna/page.tsx`

Current Anna-specific elements:

- route name `/anna`
- `AnnaWorkerDayClient`
- `getAnnaWorkerDelivery()`

Classification:

- route: **PROTOTYPE APPLICATION CONSTANT**
- component name: **PRESENTATION/PROTOTYPE LABEL**
- reader name and embedded membership selection: **PROTOTYPE APPLICATION CONSTANT around REAL INSTITUTIONAL DATA**

This step does not change these.

### 4. Worker Day delivery reader

File: `lib/worker-delivery.ts`

Current Anna-specific elements:

- `ANNA_FARM_MEMBERSHIP_ID`
- `ELM_FARM_ID`
- `getAnnaWorkerDelivery()`

Classification:

- membership/farm IDs: **REAL INSTITUTIONAL DATA** currently selected through prototype constants
- Worker Day eligibility, carry, completion, active-attention, and unscheduled-work semantics: **CANONICAL WORKER DAY BEHAVIOR — PRESERVE**

This step does not generalize this reader yet.

### 5. Worker Day mutations

File: `app/api/anna/pilot/route.ts`

Current Anna-specific elements:

- API route name
- `getAnnaPilotSessionToken()`
- `getAnnaWorkerDelivery()`

Classification:

- route/helper names: **PROTOTYPE APPLICATION CONSTANTS**
- delivered-projection check: **SECURITY BOUNDARY — PRESERVE**
- `worker_delivery_pilot_transition_v1`: **CANONICAL/GOVERNED MUTATION BOUNDARY — PRESERVE**

This step does not modify the mutation endpoint or RPC.

## What changed in Step 1

Added:

- `lib/worker-session.ts`
- generic `WorkerSessionContext`
- `getWorkerSessionToken()`
- `resolveWorkerSessionContext()`
- `getCurrentWorkerSessionContext()`

Adapted:

- `getAnnaPilotEditState()` now consumes the generic context first when the new Elm Work Pass session cookie is present.
- legacy Anna pilot-cookie validation remains as a compatibility fallback.

## What deliberately did not change

- `/anna`
- `/today`
- Worker Day reader behavior
- Worker Day mutation behavior
- database schema
- session-status RPC
- capability scope
- Work Pass destination mapping
- employee names or presentation component names
- Personal Atlas authentication
- owner/manager `/work` namespace

## Governing invariant after Step 1

Application code now has a reusable server boundary that can answer:

> Which institutional worker position does this already-valid worker session represent?

without making the page itself the identity source.

The next approved step may move Worker Day reading behind this context, but this document does not authorize any additional architecture beyond the previously approved Employee Seat plan.
