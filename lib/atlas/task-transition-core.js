export const ATLAS_TASK_TRANSITIONS = Object.freeze([
  "done",
  "partial",
  "blocked",
  "not_relevant",
  "changed_plan",
  "rescheduled",
  "unfinished",
  "checklist_done",
  "checklist_open",
  "note",
]);

export const ATLAS_FARM_HAND_TRANSITIONS = Object.freeze([
  "done",
  "blocked",
  "note",
]);

const TRANSITIONS = new Set(ATLAS_TASK_TRANSITIONS);
const FARM_HAND_TRANSITIONS = new Set(ATLAS_FARM_HAND_TRANSITIONS);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class AtlasTaskTransitionInputError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AtlasTaskTransitionInputError";
    this.status = status;
    this.code = code;
  }
}

function requiredText(input, key, maxLength) {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value) {
    throw new AtlasTaskTransitionInputError(400, `${key}_required`, `${key} is required.`);
  }
  if (value.length > maxLength) {
    throw new AtlasTaskTransitionInputError(400, `${key}_too_long`, `${key} is too long.`);
  }
  return value;
}

function optionalText(input, key, maxLength) {
  const raw = input[key];
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") {
    throw new AtlasTaskTransitionInputError(400, `${key}_invalid`, `${key} must be text.`);
  }
  const value = raw.trim();
  if (!value) return null;
  if (value.length > maxLength) {
    throw new AtlasTaskTransitionInputError(400, `${key}_too_long`, `${key} is too long.`);
  }
  return value;
}

export function normalizeAtlasTaskTransitionInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AtlasTaskTransitionInputError(400, "invalid_body", "Atlas request body must be an object.");
  }

  const taskId = requiredText(input, "taskId", 36);
  if (!UUID_PATTERN.test(taskId)) {
    throw new AtlasTaskTransitionInputError(400, "invalid_task_id", "taskId must be a UUID.");
  }

  const transition = requiredText(input, "transition", 32);
  if (!TRANSITIONS.has(transition)) {
    throw new AtlasTaskTransitionInputError(400, "unsupported_transition", "Unsupported task transition.");
  }

  const idempotencyKey = requiredText(input, "idempotencyKey", 160);
  const targetDate = optionalText(input, "targetDate", 10);
  if (targetDate && !ISO_DATE_PATTERN.test(targetDate)) {
    throw new AtlasTaskTransitionInputError(400, "invalid_target_date", "targetDate must use YYYY-MM-DD.");
  }
  if ((transition === "rescheduled" || transition === "unfinished") && !targetDate) {
    throw new AtlasTaskTransitionInputError(400, "target_date_required", "A target date is required for this transition.");
  }

  const note = optionalText(input, "note", 4000);
  const reason = optionalText(input, "reason", 4000);
  const laneKey = optionalText(input, "laneKey", 120);
  const workKey = optionalText(input, "workKey", 120);
  const existingFieldLogId = optionalText(input, "existingFieldLogId", 36);
  if (existingFieldLogId && !UUID_PATTERN.test(existingFieldLogId)) {
    throw new AtlasTaskTransitionInputError(400, "invalid_field_log_id", "existingFieldLogId must be a UUID.");
  }

  const rawPayload = input.payload;
  if (rawPayload !== undefined && rawPayload !== null && (
    typeof rawPayload !== "object" || Array.isArray(rawPayload)
  )) {
    throw new AtlasTaskTransitionInputError(400, "invalid_payload", "payload must be an object.");
  }

  return {
    taskId,
    transition,
    idempotencyKey,
    targetDate,
    note,
    reason,
    laneKey,
    workKey,
    payload: rawPayload ?? {},
    existingFieldLogId,
  };
}

export function atlasTaskTransitionRpcForRole(role, transition) {
  if (role === "owner") return "owner_record_task_transition_v1";

  if (role === "farm_hand") {
    if (!FARM_HAND_TRANSITIONS.has(transition)) {
      throw new AtlasTaskTransitionInputError(
        403,
        "farm_hand_transition_not_allowed",
        "Farm Hands can mark assigned work done, blocked, or add a note.",
      );
    }
    return "worker_record_task_transition_v1";
  }

  throw new AtlasTaskTransitionInputError(
    403,
    "manager_transition_not_available",
    "Manager task changes are not enabled yet.",
  );
}
