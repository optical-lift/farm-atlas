const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidInviteId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function safeInviteRedirect(origin, redirectTo) {
  const fallback = new URL("/onboarding/invite", origin);
  if (typeof redirectTo !== "string" || !redirectTo.trim()) return fallback;

  try {
    const candidate = new URL(redirectTo);
    if (candidate.origin !== fallback.origin || candidate.pathname !== "/onboarding/invite") {
      return fallback;
    }
    return candidate;
  } catch {
    return fallback;
  }
}

export function membershipHomeForRole(role) {
  if (role === "owner") return "/owner";
  if (role === "manager") return "/manage";
  if (role === "farm_hand") return "/work/today";
  return "/";
}

export function invitationsEnabled(value) {
  return value === "true";
}
