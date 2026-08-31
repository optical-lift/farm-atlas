function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function humanSignupEnabled(value) {
  return asText(value).toLowerCase() === "true";
}

export function normalizeHumanSignupInput(body) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const displayName = asText(source.displayName);
  const email = asText(source.email).toLowerCase();
  const password = typeof source.password === "string" ? source.password : "";

  if (!displayName || !email || !email.includes("@")) {
    return { ok: false, error: "Enter your name and email." };
  }

  if (password.length < 12) {
    return { ok: false, error: "Use a password with at least 12 characters." };
  }

  return {
    ok: true,
    value: { displayName, email, password },
  };
}

export function atlasAuthConfirmationNext(value) {
  return value === "/onboarding" ? "/onboarding" : "/onboarding";
}
