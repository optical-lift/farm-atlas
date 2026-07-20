# Atlas Phase B — Identity and Protected Route Status

**Date:** July 20, 2026  
**Production head:** `eb89983960f535129c4f20267fafaaf04e36c64b`

## Completed

- Standard Supabase SSR session cookies and refresh proxy.
- One normalized `getAtlasSession()` resolver.
- Active farm membership returned in one stable shape.
- Deterministic Owner, Manager, and Farm-Hand fixtures.
- Explicit session states: anonymous, no membership, active.
- Account-neutral login; no hardcoded email or password alias.
- Signed-in password-change endpoint and settings page.
- Protected Owner layout at `/owner`.
- Protected Manager layout at `/manage`.
- Protected worker layout at `/work/today`.
- Farm launcher cards route into the correct protected perspective.
- Legacy `/marshall` redirects to `/manage`.
- Login preserves a safe requested `next` path.
- Anonymous requests to protected routes resolve to Login.
- 34 automated tests pass, including role-boundary tests.

## Current role boundary

| Perspective | Route | Allowed memberships |
|---|---|---|
| Owner | `/owner` | Owner |
| Manager | `/manage` | Owner, Manager |
| Worker-safe lens | `/work/today` | Owner, Manager, Farm Hand |

The worker layout intentionally permits Owner and Manager memberships to inspect the worker-safe projection. It does not grant Farm Hands access to management or Owner routes.

## Password status

The connector did not permit an administrative credential reset. Atlas now provides a supported signed-in password-change flow at `/settings/password`. No temporary password is stored in source control.

## Next vertical slice

Build the first authorized Owner data path:

```text
verified session
→ Owner membership
→ selected farm
→ server-only Owner task query
→ Owner dashboard projection
```

The next code should begin the Atlas data layer rather than reading operational tables directly from the Owner page.
