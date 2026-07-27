# Organization session read grant

The Atlas session loader reads `atlas.organization_memberships` and joins `atlas.organizations` immediately after authentication. Table privileges must allow authenticated `SELECT`; row-level policies remain the authorization boundary.

The production incident fixed by `20260727234500_grant_organization_session_read_v1.sql` was caused by RLS policies existing without the corresponding authenticated table grant.
