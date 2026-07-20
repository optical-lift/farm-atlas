# Atlas Phase B — Identity, Role Layout, and First Data Paths

**Date:** July 20, 2026

## Completed identity core

- Standard Supabase SSR session cookies and refresh proxy.
- One normalized `getAtlasSession()` resolver.
- Active farm membership returned in one stable shape.
- Deterministic Owner, Manager, and Farm-Hand fixtures.
- Explicit session states: anonymous, no membership, active.
- Account-neutral login; no hardcoded email or password alias.
- Signed-in password-change endpoint and settings page.
- A temporary build credential created through one-use Admin Auth and not stored in source control.
- The one-use credential-reset route removed immediately after use.

## Protected perspectives

- Protected Owner layout at `/owner`.
- Protected Manager layout at `/manage`.
- Protected worker layout at `/work/today`.
- Farm launcher cards route into the correct protected perspective.
- Legacy `/marshall` redirects to `/manage`.
- Login preserves a safe requested `next` path.
- Anonymous requests to protected routes resolve to Login.

| Perspective | Route | Allowed memberships |
|---|---|---|
| Owner | `/owner` | Owner |
| Manager | `/manage` | Owner, Manager |
| Worker-safe lens | `/work/today` | Owner, Manager, Farm Hand |

The worker layout intentionally permits Owner and Manager memberships to inspect the worker-safe projection. It does not grant Farm Hands access to management or Owner routes.

## First authorized Owner vertical slice

```text
verified session
→ Owner membership
→ selected farm
→ user-scoped task query
→ Owner dashboard projection
→ secure Owner task detail
→ controlled Owner task action
```

Implemented boundaries:

- `atlas.tasks` permits authenticated Owner reads only for owned farms.
- Owner dashboard data comes from `lib/atlas-data`, not browser task-list APIs.
- Owner actions link to `/owner/tasks/[taskId]`, not the legacy task-focus route.
- Direct authenticated and anonymous execution of the broad transition RPC is revoked.
- An Owner-checked database wrapper exists for the transition engine.
- The application transition endpoint verifies session, task visibility, farm, Owner membership, request origin, intent, and idempotency.
- The legacy general `/api/atlas/task-transition` endpoint returns `410 Gone`.

## Normalized task visibility foundation

`atlas.tasks` now has:

- `visibility_scope`
- `assigned_membership_id`
- a same-farm, active-membership assignment trigger
- an index for farm, visibility, assignment, status, and due date

Current migrated scopes:

- 45 Owner tasks
- 2,631 management tasks
- 662 assigned-worker tasks

The 662 worker tasks remain deliberately unassigned until real Farm-Hand memberships exist. This prevents historical Anna metadata from becoming an authorization grant.

Manager RLS permits management, assigned-worker, and farm-shared scopes while excluding Owner and system-internal tasks. Farm Hands still have no direct base-table task policy.

## Manager read path

The Manager home now uses a server-only, farm-scoped task projection. It shows:

- blocked work
- overdue work
- due-today work
- worker work needing assignment
- the management queue

An Owner may inspect the Manager lens, but the query explicitly limits itself to Manager-visible scopes.

## Owner membership registry

- `/owner/members` lists active farm memberships through an Owner-checked database function.
- Invitation drafts record intended Manager or Farm-Hand access without creating an Auth account or sending email.
- Farm-Hand drafts require a normalized worker key.
- Drafts are prepared and revoked through controlled authenticated functions.
- The invitation table has RLS enabled and no direct application grants.

## Validation

- 47 automated tests pass, including identity, role, Owner projection, Owner action, Manager projection, and invitation validation tests.
- The corrected registry head passes TypeScript and the complete Next.js production build in Vercel preview.
- Owner RLS simulation exposes owned-farm tasks and zero tasks to an unrelated authenticated identity.
- A rolled-back Manager membership simulation exposed 2,631 management tasks and 662 assigned-worker tasks while exposing zero Owner tasks.
- Lex’s real membership remained Owner after the transaction rolled back.

## Next vertical slice

Implement explicit invitation sending and atomic acceptance before creating live Manager or Farm-Hand accounts. After acceptance, bind the migrated worker tasks to the real Farm-Hand membership and build a worker-safe prepared task projection rather than granting Farm Hands direct access to `atlas.tasks`.
