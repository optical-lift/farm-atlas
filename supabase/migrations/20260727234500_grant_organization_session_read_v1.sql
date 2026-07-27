-- The Atlas session loader reads the viewer's organization membership after login.
-- RLS still limits organization_memberships to the signed-in user and organizations
-- to organizations in which that user has an active membership.

revoke all on table atlas.organization_memberships from public, anon;
revoke all on table atlas.organizations from public, anon;

grant select on table atlas.organization_memberships to authenticated;
grant select on table atlas.organizations to authenticated;

comment on table atlas.organization_memberships is
  'Organization memberships are readable by authenticated users only through row-level policies.';
comment on table atlas.organizations is
  'Organizations are readable by authenticated members only through row-level policies.';
