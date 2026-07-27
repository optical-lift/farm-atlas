import type {
  AtlasFarmRole,
  AtlasOrganizationRole,
  AtlasSession,
  AtlasSessionMembership,
  AtlasSessionOrganizationMembership,
} from "@/lib/atlas/session";

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

export type AtlasPortalViewer = {
  userId: string;
  email: string | null;
  organizationId: string;
  organizationKey: string | null;
  organizationName: string;
  membershipId: string;
  role: AtlasOrganizationRole;
  permissions: Record<string, unknown>;
  canManagePortfolio: boolean;
  farmMemberships: AtlasSessionMembership[];
};

export type AtlasUniversalViewer = {
  userId: string;
  email: string | null;
  displayName: string;
  activeFarmId: string | null;
  activeOrganizationId: string | null;
  farmMemberships: AtlasSessionMembership[];
  organizationMemberships: AtlasSessionOrganizationMembership[];
  hasFarmScope: boolean;
  hasOrganizationScope: boolean;
  canManageAnyFarm: boolean;
  canUseAnyOwnerTools: boolean;
  canManageAnyPortfolio: boolean;
};

export function activeAtlasMembership(session: AtlasSession): AtlasSessionMembership | null {
  return session.memberships.find((membership) => membership.farmId === session.activeFarmId)
    ?? session.memberships[0]
    ?? null;
}

export function activeAtlasOrganizationMembership(
  session: AtlasSession,
): AtlasSessionOrganizationMembership | null {
  return session.organizationMemberships.find(
    (membership) => membership.organizationId === session.activeOrganizationId,
  )
    ?? session.organizationMemberships[0]
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

export function atlasPortalViewerFromSession(session: AtlasSession): AtlasPortalViewer | null {
  const membership = activeAtlasOrganizationMembership(session);
  if (!membership) return null;

  return {
    userId: session.userId,
    email: session.email,
    organizationId: membership.organizationId,
    organizationKey: membership.organizationKey,
    organizationName: membership.organizationName || "Feast Guild",
    membershipId: membership.membershipId,
    role: membership.role,
    permissions: membership.permissions,
    canManagePortfolio: membership.role === "owner",
    farmMemberships: session.memberships,
  };
}

export function atlasUniversalViewerFromSession(session: AtlasSession): AtlasUniversalViewer | null {
  if (session.memberships.length === 0 && session.organizationMemberships.length === 0) return null;

  return {
    userId: session.userId,
    email: session.email,
    displayName: session.displayName,
    activeFarmId: session.activeFarmId,
    activeOrganizationId: session.activeOrganizationId,
    farmMemberships: session.memberships,
    organizationMemberships: session.organizationMemberships,
    hasFarmScope: session.memberships.length > 0,
    hasOrganizationScope: session.organizationMemberships.length > 0,
    canManageAnyFarm: session.memberships.some(
      (membership) => membership.role === "owner" || membership.role === "manager",
    ),
    canUseAnyOwnerTools: session.memberships.some((membership) => membership.role === "owner"),
    canManageAnyPortfolio: session.organizationMemberships.some(
      (membership) => membership.role === "owner",
    ),
  };
}
