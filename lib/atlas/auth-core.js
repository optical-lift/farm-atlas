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
      activeLedgerSeat: null,
    };
  }

  const memberships = Array.isArray(session.memberships) ? session.memberships : [];
  const organizationMemberships = Array.isArray(session.organizationMemberships)
    ? session.organizationMemberships
    : [];
  const ledgerSeats = Array.isArray(session.ledgerSeats) ? session.ledgerSeats : [];
  const activeFarmId = typeof session.activeFarmId === "string" ? session.activeFarmId : null;
  const activeOrganizationId =
    typeof session.activeOrganizationId === "string" ? session.activeOrganizationId : null;
  const activeLedgerId =
    typeof session.activeLedgerId === "string" ? session.activeLedgerId : null;
  const activeMembership =
    memberships.find((membership) => membership?.farmId === activeFarmId) ?? memberships[0] ?? null;
  const activeOrganizationMembership =
    organizationMemberships.find(
      (membership) => membership?.organizationId === activeOrganizationId,
    ) ?? organizationMemberships[0] ?? null;
  const activeLedgerSeat =
    ledgerSeats.find((seat) => seat?.ledgerId === activeLedgerId) ?? ledgerSeats[0] ?? null;

  if (
    session.realityState !== "ready"
    || typeof session.personEntityId !== "string"
    || typeof session.personalAtlasId !== "string"
  ) {
    return {
      status: "onboarding",
      authenticated: true,
      activeMembership,
      activeOrganizationMembership,
      activeLedgerSeat,
    };
  }

  return {
    status: "active",
    authenticated: true,
    activeMembership,
    activeOrganizationMembership,
    activeLedgerSeat,
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
