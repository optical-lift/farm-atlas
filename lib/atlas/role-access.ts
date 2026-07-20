import { redirect } from "next/navigation";

import { resolveRoleAccess } from "@/lib/atlas/role-access-core.js";
import {
  getAtlasSession,
  type AtlasFarmRole,
  type AtlasSession,
  type AtlasSessionMembership,
} from "@/lib/atlas/session";

export type AtlasRoleAccess = {
  session: AtlasSession;
  membership: AtlasSessionMembership;
};

export async function requireAtlasRole(
  allowedRoles: AtlasFarmRole[],
): Promise<AtlasRoleAccess> {
  const session = await getAtlasSession();
  const access = resolveRoleAccess(session, allowedRoles);

  if (access.status !== "authorized" || !session || !access.membership) {
    redirect(access.redirectTo ?? "/");
  }

  return {
    session,
    membership: access.membership as AtlasSessionMembership,
  };
}
