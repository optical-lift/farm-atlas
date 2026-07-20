const ALLOWED_ROLES = new Set(["manager", "farm_hand"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWorkerKey(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return null;
  return raw
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || null;
}

export function normalizeMembershipInviteInput(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const farmId = text(source.farmId);
  const email = text(source.email).toLowerCase();
  const displayName = text(source.displayName);
  const role = text(source.role).toLowerCase();
  const workerKey = normalizeWorkerKey(source.workerKey);

  if (!farmId) return { ok: false, error: "Farm membership is required." };
  if (!email || !email.includes("@") || email.startsWith("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!displayName) return { ok: false, error: "Enter the person’s name." };
  if (!ALLOWED_ROLES.has(role)) {
    return { ok: false, error: "Choose Manager or Farm Hand." };
  }
  if (role === "farm_hand" && !workerKey) {
    return { ok: false, error: "A Farm Hand worker key is required." };
  }

  return {
    ok: true,
    value: {
      farmId,
      email,
      displayName,
      role,
      workerKey: role === "farm_hand" ? workerKey : workerKey,
    },
  };
}
