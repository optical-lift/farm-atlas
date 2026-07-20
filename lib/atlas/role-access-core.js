import { classifyAtlasSession, roleHomeForMembership } from "./auth-core.js";

export function resolveRoleAccess(session, allowedRoles) {
  const allowed = new Set(Array.isArray(allowedRoles) ? allowedRoles : []);
  const access = classifyAtlasSession(session);

  if (access.status === "anonymous") {
    return { status: "anonymous", membership: null, redirectTo: "/login" };
  }

  if (access.status === "no_membership") {
    return { status: "no_membership", membership: null, redirectTo: "/" };
  }

  const memberships = Array.isArray(session.memberships) ? session.memberships : [];
  const authorizedMembership = allowed.has(access.activeMembership.role)
    ? access.activeMembership
    : memberships.find((membership) => allowed.has(membership?.role)) ?? null;

  if (authorizedMembership) {
    return { status: "authorized", membership: authorizedMembership, redirectTo: null };
  }

  return {
    status: "wrong_role",
    membership: null,
    redirectTo: roleHomeForMembership(access.activeMembership) ?? "/",
  };
}
