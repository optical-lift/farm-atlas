export type AtlasWorkerDayShapeState = "resolved" | "anchor_required" | "policy_conflict" | string;
export type AtlasWorkerDayChronologyState = "proposed" | "anchor_required" | "policy_conflict" | "conflict" | string;

export type AtlasWorkerDayShape = {
  contractVersion: string;
  serviceDate: string | null;
  state: AtlasWorkerDayShapeState;
  requiresOwnerDayShape: boolean;
  timezone: string;
  matchingPolicyCount: number;
  policyId: string | null;
  policyKey: string | null;
  policyName: string | null;
  policyVersion: number | null;
  weekdays: number[];
  localStart: string | null;
  localEnd: string | null;
  startsAt: string | null;
  endsAt: string | null;
  elapsedMinutes: number | null;
  configuredActiveTargetMinutes: number;
  configuredMaximumPlannedMinutes: number;
  expectedElapsedWorkdayMinutes: number;
  effectiveFrom: string | null;
  effectiveThrough: string | null;
};

export type AtlasWorkerDayChronologyItem = {
  taskId: string | null;
  title: string;
  dayWindow: "morning" | "afternoon" | "evening" | null;
  chronologyState: string;
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number;
  timelineAuthority: "committed" | "proposal" | "none" | string;
  selectionIndex: number | null;
  sequenceIndex: number | null;
};

export type AtlasWorkerDayChronology = {
  contractVersion: string;
  farmId: string;
  membershipId: string;
  serviceDate: string;
  state: AtlasWorkerDayChronologyState;
  proposalIsAuthoritative: false;
  dayShape: AtlasWorkerDayShape;
  items: AtlasWorkerDayChronologyItem[];
  nextUp: unknown[];
  unplacedCount: number;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown, fallback = 0) {
  const parsed = number(value);
  return parsed === null ? fallback : Math.round(parsed);
}

function normalizeDayShape(value: unknown): AtlasWorkerDayShape {
  const row = object(value) ?? {};
  return {
    contractVersion: String(row.contractVersion || "worker_day_shape_effective_v1"),
    serviceDate: text(row.serviceDate),
    state: String(row.state || "anchor_required"),
    requiresOwnerDayShape: row.requiresOwnerDayShape !== false,
    timezone: text(row.timezone) ?? "America/Chicago",
    matchingPolicyCount: integer(row.matchingPolicyCount),
    policyId: text(row.policyId),
    policyKey: text(row.policyKey),
    policyName: text(row.policyName),
    policyVersion: number(row.policyVersion) === null ? null : integer(row.policyVersion),
    weekdays: Array.isArray(row.weekdays)
      ? row.weekdays.map((weekday) => integer(weekday, -1)).filter((weekday) => weekday >= 0 && weekday <= 6)
      : [],
    localStart: text(row.localStart),
    localEnd: text(row.localEnd),
    startsAt: text(row.startsAt),
    endsAt: text(row.endsAt),
    elapsedMinutes: number(row.elapsedMinutes) === null ? null : integer(row.elapsedMinutes),
    configuredActiveTargetMinutes: integer(row.configuredActiveTargetMinutes),
    configuredMaximumPlannedMinutes: integer(row.configuredMaximumPlannedMinutes),
    expectedElapsedWorkdayMinutes: integer(row.expectedElapsedWorkdayMinutes),
    effectiveFrom: text(row.effectiveFrom),
    effectiveThrough: text(row.effectiveThrough),
  };
}

function normalizeItem(value: unknown): AtlasWorkerDayChronologyItem | null {
  const row = object(value);
  if (!row || typeof row.title !== "string") return null;
  const window = row.dayWindow;
  return {
    taskId: text(row.taskId),
    title: row.title,
    dayWindow: window === "morning" || window === "afternoon" || window === "evening" ? window : null,
    chronologyState: String(row.chronologyState || "unknown"),
    startsAt: text(row.startsAt),
    endsAt: text(row.endsAt),
    durationMinutes: Math.max(0, integer(row.durationMinutes)),
    timelineAuthority: String(row.timelineAuthority || "none"),
    selectionIndex: number(row.selectionIndex) === null ? null : integer(row.selectionIndex),
    sequenceIndex: number(row.sequenceIndex) === null ? null : integer(row.sequenceIndex),
  };
}

export function normalizeAtlasWorkerDayChronology(value: unknown): AtlasWorkerDayChronology | null {
  const row = object(value);
  if (!row) return null;
  return {
    contractVersion: String(row.contractVersion || "worker_day_chronology_v1"),
    farmId: String(row.farmId || ""),
    membershipId: String(row.membershipId || ""),
    serviceDate: String(row.serviceDate || ""),
    state: String(row.state || "anchor_required"),
    proposalIsAuthoritative: false,
    dayShape: normalizeDayShape(row.dayShape),
    items: Array.isArray(row.items)
      ? row.items.map(normalizeItem).filter((item): item is AtlasWorkerDayChronologyItem => Boolean(item))
      : [],
    nextUp: Array.isArray(row.nextUp) ? row.nextUp : [],
    unplacedCount: Math.max(0, integer(row.unplacedCount)),
  };
}
