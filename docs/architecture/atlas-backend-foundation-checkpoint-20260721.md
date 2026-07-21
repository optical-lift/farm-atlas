# Atlas Backend Foundation Checkpoint — 2026-07-21

This checkpoint records the behind-the-scenes foundation required before Atlas screens are restored.

## Status

The identity, authorization, farm-state read, scheduling, Quick Log, planting-claim, and client gateway layers now have coherent contracts. The next build phase may reconnect and replace presentation routes without reviving legacy page-specific Supabase queries or client-supplied role scope.

## Completed foundations

### Identity and membership

- One normalized Supabase SSR session.
- Farm-scoped Owner, Manager, and Farm-Hand memberships.
- Protected role route groups.
- Real build accounts for role testing.

### Canonical operational state

`atlas.v_farm_object_operational_state` prepares one row per farm object containing:

- farm, zone, and object identity;
- current object state;
- active crop cycle and stage;
- last meaningful action;
- next task or maintenance action;
- blocker;
- assignment;
- maintenance pressure;
- risk level.

Owner and Manager may read the full operational state for farms they operate. Farm Hands do not receive broad object-state access and continue through prepared worker projections.

### Role-aware task schedule

`atlas.task_schedule_v1` is the canonical Day, Week, and Month task source.

- Owner sees Owner, management, assigned-worker, and shared work.
- Manager sees management, assigned-worker, and shared work.
- Farm Hand sees their own assigned work plus explicitly shared work.
- Completed tasks are returned for the selected date window.
- Blocked, overdue, and undated carryover remain separate from exact-date progress.
- Progress counts only tasks due inside the selected window.
- Client-supplied role names and scope labels do not grant access.

### Authenticated Quick Log

`atlas.record_quick_log_v1` records real field activity through one transaction.

- Actor user, membership, and role come from the signed-in session.
- Farm zones and objects are validated against the active farm.
- Writes are idempotent.
- Field logs, object links, activity events, and touched-object state are updated together.
- Flexible farm action language is preserved within bounded validation.
- Direct authenticated writes to the underlying memory tables are revoked.

### Authenticated planting claim

`atlas.record_planting_claim_v1` is the standalone management planting transaction.

- Owner and Manager may create a planting claim.
- Farm Hand standalone planting claims are rejected; Farm Hands may still execute assigned planting work through the worker task flow.
- The transaction creates the linked field log, planting claim, object links, object contents, object activity, object state, and crop-cycle registry entries.
- Crop-profile timing derives germination, harvest-watch, and clear dates.
- The transaction is idempotent and relationally attributes the actor.
- Direct authenticated writes to claim/content/cycle tables are revoked.

### Server-only Atlas data layer

Current canonical readers and writers:

- `getFarmOperationalState`
- `getZoneOperationalState`
- `getTaskSchedule`
- `getDaySchedule`
- `getWeekSchedule`
- `getMonthSchedule`
- `recordQuickLog`
- `getPlantingClaimCatalog`
- `recordPlantingClaim`

### Authenticated client gateway

The following neutral API boundaries are available for interactive client components:

- `GET /api/atlas/operations/state`
- `GET /api/atlas/schedule`
- `POST /api/atlas/quick-log`
- `GET /api/atlas/planting-claims`
- `POST /api/atlas/planting-claims`

Each route resolves the signed-in farm membership server-side. None accepts `owner`, `anna`, `marshall`, or a query-string scope as authorization.

## Validation

- Role simulations confirmed Owner and Manager can read 145 Elm operational objects.
- Farm Hand broad operational-state access returns zero rows.
- Schedule simulations confirmed no Owner-work leakage to Manager or Farm Hand.
- Quick Log was tested end to end with Anna inside a rollback, including idempotent replay and relational actor attribution.
- Planting claim was tested end to end with Lex inside a rollback, including profile timing, object contents, crop cycle creation, and idempotent replay.
- Farm-Hand use of the standalone planting claim was rejected and created zero records.
- Database rollback tests left no test farm records behind.
- Strict GitHub CI passed all 74 tests and the full Next.js production build against the completed foundation.

## Remaining known backend debt

The following tables still have Row Level Security disabled and require individual classification before broad restoration work reaches them:

- `atlas.inbox_items`
- `atlas.object_activity_events`
- `atlas.rhythm_templates`
- `atlas.project_task_links`
- `atlas.crop_cycle_impacts`
- `atlas.crop_profile_aliases`
- `atlas.crop_observation_types`
- `atlas.task_crop_cycles`

The new authenticated write functions do not grant direct authenticated mutation access to `object_activity_events`, but the table remains part of the later security cleanup.

## Next build phase

Restore screens against the new foundation in this order:

1. Owner farm home using canonical operational state and schedule.
2. Day overview using the canonical schedule and exact-date progress.
3. Week and Month overviews using the same schedule contract.
4. Zone and object pages using canonical operational state.
5. Quick Log form using the authenticated gateway.
6. Claim Planting form using the planting catalog and transaction.
7. Projects, resources, production, and remaining legacy features one bounded capability at a time.

A restored route replaces its legacy data path. The old and new authorization systems must not remain active beside each other.
