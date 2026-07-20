# Atlas Phase B — Password and Role Access Note

**Date:** July 20, 2026

## Temporary build password

The selected temporary build password is not stored in the repository. The connector did not permit an administrative password reset. Atlas now exposes a signed-in password-change page at `/settings/password`, linked as **Account** from the farm launcher.

The existing Supabase credential remains active until the Owner changes it through that page.

## Protected route behavior

- `/owner` requires an Owner membership.
- `/manage` requires an Owner or Manager membership.
- `/work/today` requires any active farm membership and returns the worker-safe perspective.
- `/marshall` is a compatibility redirect to `/manage`.
- Anonymous access to protected routes resolves to Login.
- Login preserves a safe requested `next` path.

## Validation

- 34 automated tests pass.
- Production TypeScript and Next.js builds pass.
- Anonymous production access to `/owner` resolves to Login.
