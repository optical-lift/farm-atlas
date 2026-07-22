export function normalizeAtlasLoginCredentials(body) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const email = typeof source.email === "string" ? source.email.trim().toLowerCase() : "";
  const password = typeof source.password === "string" ? source.password : "";

  if (!email || !password) return null;
  return { email, password };
}

export function atlasPostLoginPath() {
  return "/";
}

export function classifyAtlasSession(session) {
  if (!session || typeof session !== "object") {
    return {
      status: "anonymous",
      authenticated: false,
      activeMembership: null,
    };
  }

  const memberships = Array.isArray(session.memberships) ? session.memberships : [];
  const activeFarmId = typeof session.activeFarmId === "string" ? session.activeFarmId : null;
  const activeMembership =
    memberships.find((membership) => membership?.farmId === activeFarmId) ?? memberships[0] ?? null;

  if (!activeMembership) {
    return {
      status: "no_membership",
      authenticated: true,
      activeMembership: null,
    };
  }

  return {
    status: "active",
    authenticated: true,
    activeMembership,
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
