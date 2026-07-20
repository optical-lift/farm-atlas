import Link from "next/link";

import { getAtlasIdentity } from "@/lib/atlas-auth";

export default async function AtlasRoleNavigation() {
  const identity = await getAtlasIdentity();
  if (!identity) return null;

  const owner = identity.memberships.some((membership) => membership.active && membership.role === "owner");
  const manager = identity.memberships.some((membership) => membership.active && membership.role === "manager");

  return (
    <nav className="atlas-role-navigation" aria-label="Atlas account navigation">
      <Link href="/">Farm</Link>
      {owner ? <Link href="/owner">Owner</Link> : null}
      {manager ? <Link href="/marshall">Manage</Link> : null}
      <form action="/api/atlas/auth/logout" method="post">
        <button type="submit">Sign out</button>
      </form>
    </nav>
  );
}
