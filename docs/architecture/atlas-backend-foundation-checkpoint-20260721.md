# Atlas Backend Foundation Checkpoint — 2026-07-21

This checkpoint records the secured Atlas foundation and the first restored presentation routes.

## Status

The identity, authorization, farm-state read, scheduling, Quick Log, planting-claim, client gateway, database-policy, and transition-integrity layers now have coherent contracts.

Owner Home, Day, Week, and Month have been moved onto those contracts. They no longer depend on the legacy service-role task-card feed, browser-side role scope, or metadata fields such as `owner_task`, `anna_task`, or `assigned_to` for authorization.

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

### Closed database boundary

- All Atlas tables have Row Level Security enabled.
- Farm-scoped operational tables use active membership reads.
- Parent-linked project/task/crop relationships inherit parent visibility.
- Direct browser writes remain closed except through controlled functions.
- Anonymous production-plan and production-succession writes are removed.
- Legacy definer views are `security_invoker` and reserved for trusted server use.
- Legacy maintenance, reconciliation, crop-observation, timeline, and trigger functions are not public RPCs.
- Only membership-aware Atlas `SECURITY DEFINER` contracts remain executable by signed-in users.
- `farm_membership_invites` intentionally has no direct table policy or user grant; its controlled invitation functions govern the lifecycle.

### Transition reconciliation

The audited transition debt has been closed:

- every Elm physical object has an `object_state` row;
- every active planting claim has a physical object link;
- the four detached planting claims now have object contents, field-log links, activity events, state memory, and crop cycles;
- the five Anna Network tasks point to Anna's real membership;
- all transition identity reviews are resolved or explicitly dismissed;
- historical field logs with unknowable actors are marked `migrated_unknown` instead of being guessed;
- GitHub and Supabase migration history agree on the task-relationship migration version.

`atlas.v_transition_integrity` is the permanent deploy-check surface. For Elm Farm it currently reports zero for:

- objects without state;
- active planting claims without object links;
- assigned-worker tasks without memberships;
- open identity reviews;
- anonymous production write grants;
- anonymous Atlas definer functions;
- anonymous legacy-view reads.

## Restored screens

- Owner Home reads canonical operational state and the role-aware schedule.
- Day reads `getDaySchedule` and keeps carryover separate from exact-date work.
- Week reads the canonical schedule for its selected window.
- Month reads `getMonthSchedule` for real month bounds.
- These routes are server-rendered behind Owner/Manager membership checks.
- CI fails if these screens reintroduce the service-role task-card client or metadata-based authorization.

## Validation

- Role simulations confirmed Owner and Manager can read 145 Elm operational objects.
- Farm Hand broad operational-state access returns zero rows.
- Schedule simulations confirmed no Owner-work leakage to Manager or Farm Hand.
- Quick Log was tested end to end with Anna inside a rollback, including idempotent replay and relational actor attribution.
- Planting claim was tested end to end with Lex inside a rollback, including profile timing, object contents, crop cycle creation, and idempotent replay.
- Farm-Hand use of the standalone planting claim was rejected and created zero records.
- Database rollback tests left no test farm records behind.
- Live logged-out operational-state, schedule, and planting-claim gateways return private, non-cacheable `401` responses.
- Transition integrity currently reports zero gaps for Elm Farm.

## Next build phase

Continue screen restoration in this order:

1. Zone and object pages using canonical operational state.
2. Quick Log form using the authenticated gateway.
3. Claim Planting form using the planting catalog and transaction.
4. Projects, resources, and production through bounded membership-aware capabilities.
5. Remaining legacy features one route at a time.

A restored route replaces its legacy data path. The old and new authorization systems must not remain active beside each other.
