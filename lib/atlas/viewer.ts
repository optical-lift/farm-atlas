import type { AtlasFarmRole, AtlasSession, AtlasSessionMembership } from "@/lib/atlas/session";

export type AtlasViewer = {
  userId: string;
  email: string | null;
  displayName: string;
  farmId: string;
  farmKey: string | null;
  farmName: string;
  membershipId: string;
  role: AtlasFarmRole;
  workerKey: string | null;
  permissions: Record<string, unknown>;
  canManageFarm: boolean;
  canUseOwnerTools: boolean;
};

export function activeAtlasMembership(session: AtlasSession): AtlasSessionMembership | null {
  return session.memberships.find((membership) => membership.farmId === session.activeFarmId)
    ?? session.memberships[0]
    ?? null;
}

export function atlasViewerFromSession(session: AtlasSession): AtlasViewer | null {
  const membership = activeAtlasMembership(session);
  if (!membership) return null;

  return {
    userId: session.userId,
    email: session.email,
    displayName: session.displayName,
    farmId: membership.farmId,
    farmKey: membership.farmKey,
    farmName: membership.farmName || "Atlas Farm",
    membershipId: membership.membershipId,
    role: membership.role,
    workerKey: membership.workerKey,
    permissions: membership.permissions,
    canManageFarm: membership.role === "owner" || membership.role === "manager",
    canUseOwnerTools: membership.role === "owner",
  };
}
