const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_PATTERN = /^[a-z0-9][a-z0-9_+ -]*$/;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requiredText(value, label, min, max) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${label} must be ${min} to ${max} characters.`);
  }
  return normalized;
}

function optionalText(value, label, max) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new Error(`${label} must not exceed ${max} characters.`);
  return normalized;
}

function uuidList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  const normalized = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (normalized.length > 50) throw new Error(`${label} may contain at most 50 records.`);
  if (normalized.some((item) => !UUID_PATTERN.test(item))) {
    throw new Error(`${label} contains an invalid identifier.`);
  }
  return normalized.sort();
}

function actionList(value) {
  if (!Array.isArray(value)) throw new Error("Quick Log actions are required.");
  const actions = [...new Set(value.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
  if (actions.length < 1 || actions.length > 12) {
    throw new Error("Quick Log requires 1 to 12 actions.");
  }
  if (actions.some((action) => action.length > 50 || !ACTION_PATTERN.test(action))) {
    throw new Error("Quick Log actions contain unsupported characters.");
  }
  return actions.sort();
}

export function validateQuickLogInput(input) {
  const source = asRecord(input);
  const logDate = requiredText(source.logDate, "Quick Log date", 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
    throw new Error("Quick Log date must be an ISO date.");
  }

  return {
    logDate,
    actionTypes: actionList(source.actionTypes),
    summarySentence: requiredText(source.summarySentence, "Quick Log summary", 3, 500),
    note: optionalText(source.note, "Quick Log note", 4000),
    zoneIds: uuidList(source.zoneIds, "Quick Log zones"),
    objectIds: uuidList(source.objectIds, "Quick Log objects"),
    idempotencyKey: requiredText(source.idempotencyKey, "Quick Log idempotency key", 8, 120),
  };
}

export function buildQuickLogResult(row) {
  const source = asRecord(row);
  return {
    fieldLogId:
      typeof source.field_log_id === "string" && source.field_log_id.trim()
        ? source.field_log_id
        : null,
    actorMembershipId:
      typeof source.actor_membership_id === "string" && source.actor_membership_id.trim()
        ? source.actor_membership_id
        : null,
    actorRole:
      typeof source.actor_role === "string" && source.actor_role.trim()
        ? source.actor_role
        : null,
    zoneLinkCount: Number(source.zone_link_count ?? 0),
    objectLinkCount: Number(source.object_link_count ?? 0),
    replayed: source.replayed === true || source.replayed === "true",
  };
}
