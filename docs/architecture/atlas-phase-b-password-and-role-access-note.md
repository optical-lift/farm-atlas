# Atlas Phase B — Password and Role Access Note

**Date:** July 20, 2026

## Temporary build password

A new temporary build password was created through a one-use Supabase Admin Auth route. The generated password was returned only to the active build session and is not stored in the repository.

The one-use reset route was deleted immediately after the Auth update succeeded. Supabase records the one-use marker in the user’s Auth metadata, preventing the same reset operation from being repeated.

Atlas also retains the normal signed-in password-change page at `/settings/password`, linked as **Account** from the farm launcher.

## Protected route behavior

- `/owner` requires an Owner membership.
- `/manage` requires an Owner or Manager membership.
- `/work/today` requires any active farm membership and returns the worker-safe perspective.
- `/marshall` is a compatibility redirect to `/manage`.
- Anonymous access to protected routes resolves to Login.
- Login preserves a safe requested `next` path.

## Current data boundaries

- Owner task reads use the authenticated user’s Supabase session and Owner RLS.
- Owner task actions use a farm-verified Owner endpoint.
- The legacy general task-transition endpoint is retired.
- Task visibility is normalized as `owner`, `management`, `assigned_worker`, `farm_shared`, or `system_internal`.
- Manager reads exclude Owner and system-internal task scopes.
- Farm Hands still have no direct base-table task access.

## Validation

- 43 automated tests pass.
- Production TypeScript and Next.js builds pass.
- Anonymous production access to Owner routes resolves to Login.
- Owner RLS exposes all owned-farm tasks and zero tasks to an unrelated authenticated identity.
- A rolled-back Manager policy test exposed management and worker queues while exposing zero Owner tasks.
