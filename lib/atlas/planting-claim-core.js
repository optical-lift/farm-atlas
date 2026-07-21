const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PLANTING_METHODS = [
  "direct_sow",
  "transplant",
  "clump",
  "division",
  "start",
  "bulb",
  "seed_scatter",
  "full_bed_claim",
];

export const PLANTING_COVERAGE_KINDS = [
  "whole_object",
  "full_bed",
  "partial_object",
  "row",
  "section",
];

export const PLANTING_CONFIDENCE_LEVELS = [
  "unknown",
  "low",
  "medium",
  "high",
  "field_logged",
];

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

function optionalUuid(value, label) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function uuidList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} are required.`);
  const normalized = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (normalized.length < 1 || normalized.length > 50) {
    throw new Error(`${label} must contain 1 to 50 records.`);
  }
  if (normalized.some((item) => !UUID_PATTERN.test(item))) {
    throw new Error(`${label} contain an invalid identifier.`);
  }
  return normalized.sort();
}

function positiveNumber(value, label, maximum) {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > maximum) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return normalized;
}

function optionalPositiveNumber(value, label, maximum) {
  if (value == null || value === "") return null;
  return positiveNumber(value, label, maximum);
}

function controlledValue(value, label, allowed, fallback = null) {
  const normalized = String(value ?? fallback ?? "").trim().toLowerCase();
  if (!allowed.includes(normalized)) throw new Error(`${label} is unsupported.`);
  return normalized;
}

export function validatePlantingClaimInput(input) {
  const source = asRecord(input);
  const plantedDate = requiredText(source.plantedDate, "Planting date", 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plantedDate)) {
    throw new Error("Planting date must be an ISO date.");
  }

  return {
    plantedDate,
    cropLabel: requiredText(source.cropLabel, "Crop label", 1, 120),
    variety: optionalText(source.variety, "Variety", 160),
    plantingMethod: controlledValue(
      source.plantingMethod,
      "Planting method",
      PLANTING_METHODS,
    ),
    amount: positiveNumber(source.amount, "Planting amount", 10_000_000),
    unit: requiredText(source.unit, "Planting unit", 1, 50),
    objectIds: uuidList(source.objectIds, "Planting objects"),
    cropProfileId: optionalUuid(source.cropProfileId, "Crop profile"),
    coverageKind: controlledValue(
      source.coverageKind,
      "Coverage kind",
      PLANTING_COVERAGE_KINDS,
      "whole_object",
    ),
    bedLengthFt: optionalPositiveNumber(source.bedLengthFt, "Bed length", 10_000),
    bedWidthFt: optionalPositiveNumber(source.bedWidthFt, "Bed width", 1_000),
    confidence: controlledValue(
      source.confidence,
      "Planting confidence",
      PLANTING_CONFIDENCE_LEVELS,
      "field_logged",
    ),
    note: optionalText(source.note, "Planting note", 4_000),
    idempotencyKey: requiredText(
      source.idempotencyKey,
      "Planting idempotency key",
      8,
      120,
    ),
  };
}

function numberValue(value) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildPlantingClaimResult(row) {
  const source = asRecord(row);
  return {
    plantingClaimId: text(source.planting_claim_id),
    fieldLogId: text(source.field_log_id),
    actorMembershipId: text(source.actor_membership_id),
    actorRole: text(source.actor_role),
    objectCount: numberValue(source.object_count),
    objectContentCount: numberValue(source.object_content_count),
    cropCycleCount: numberValue(source.crop_cycle_count),
    timing: {
      germinationStart: text(source.expected_germination_start),
      germinationEnd: text(source.expected_germination_end),
      harvestWatchStart: text(source.expected_harvest_watch_start),
      harvestWatchEnd: text(source.expected_harvest_watch_end),
      expectedClearDate: text(source.expected_clear_date),
    },
    replayed: source.replayed === true || source.replayed === "true",
  };
}
