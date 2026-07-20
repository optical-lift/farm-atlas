# Atlas Phase B — Owner Membership Registry

**Date:** July 20, 2026

## Purpose

Atlas now has an Owner-controlled place to prepare real Manager and Farm-Hand access without inventing live accounts or sending invitations before onboarding is complete.

## Current behavior

- `/owner/members` is protected by the Owner layout.
- The directory is returned by `owner_list_farm_members_v1` after verifying Owner membership for the requested farm.
- Current memberships are joined to Auth email and Atlas display name inside the controlled database function.
- Invitation drafts record email, display name, role, worker key, preparing Owner, and status.
- Draft preparation does not create an Auth user and does not send an email.
- Drafts may be removed before they are sent.
- Only `manager` and `farm_hand` invitation roles are accepted by this initial flow.
- Farm Hands require a normalized worker key.
- The invitation table has RLS enabled and no direct client grants.
- Owner interaction occurs only through authenticated security-definer functions with fixed search paths.

## Deliberate limitation

Invitation sending and acceptance are not implemented yet. That work requires a complete Auth callback and membership-acceptance transaction so an email can never create a half-attached Atlas account.

## Next slice

```text
Owner invitation draft
→ explicit send action
→ Supabase Auth invitation
→ callback verification
→ atomic profile + farm membership creation
→ assignment of migrated worker tasks
→ worker-safe prepared task projection
```
