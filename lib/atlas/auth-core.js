export function normalizeAtlasLoginCredentials(body) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const email = typeof source.email === "string" ? source.email.trim().toLowerCase() : "";
  const password = typeof source.password === "string" ? source.password : "";

  if (!email || !password) return null;
  return { email, password };
}

export function atlasPostLoginPath() {
  return "/onboarding";
}

export function classifyAtlasSession(session) {
  if (!session || typeof session !== "object") {
    return {
      status: "anonymous",
      authenticated: false,
      activeMembership: null,
      activeOrganizationMembership: null,
    };
  }

  const memberships = Array.isArray(session.memberships) ? session.memberships : [];
  const organizationMemberships = Array.isArray(session.organizationMemberships)
    ? session.organizationMemberships
    : [];
  const activeFarmId = typeof session.activeFarmId === "string" ? session.activeFarmId : null;
  const activeOrganizationId =
    typeof session.activeOrganizationId === "string" ? session.activeOrganizationId : null;
  const activeMembership =
    memberships.find((membership) => membership?.farmId === activeFarmId) ?? memberships[0] ?? null;
  const activeOrganizationMembership =
    organizationMemberships.find(
      (membership) => membership?.organizationId === activeOrganizationId,
    ) ?? organizationMemberships[0] ?? null;

  if (!activeMembership && !activeOrganizationMembership) {
    return {
      status: "onboarding",
      authenticated: true,
      activeMembership: null,
      activeOrganizationMembership: null,
    };
  }

  return {
    status: "active",
    authenticated: true,
    activeMembership,
    activeOrganizationMembership,
  };
}

export function roleHomeForMembership(membership) {
  if (!membership || typeof membership !== "object") return null;

  switch (membership.role) {
    case "owner":
    case "manager":
    case "farm_hand":
      return "/";
    default:
      return null;
  }
}
