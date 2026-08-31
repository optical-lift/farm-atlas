function asText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function normalizeOrganizationEstablishmentInput(body) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const name = asText(source.name);

  if (name.length < 2 || name.length > 160) {
    return { ok: false, error: "Enter an organization name between 2 and 160 characters." };
  }

  return {
    ok: true,
    value: { name },
  };
}
