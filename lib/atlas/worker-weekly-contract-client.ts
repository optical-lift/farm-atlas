export type AtlasWeeklyFarmCapacityDay = {
  serviceDate: string;
  state: string;
  capacityKnown: boolean;
  capacityClass: string;
  plannedCapacityMinutes: number | null;
  recoveryCapacityMinutes: number | null;
  blockedMinutes?: number;
  usableElapsedMinutes?: number;
};

export type AtlasWeeklyFarmWorkItem = {
  taskId: string;
  title: string;
  requiredThisWeek: boolean;
  reasonCodes: string[];
  expectedActiveMinutes: number;
  durationState: string;
  prerequisitesReady: boolean;
  resourcesReady: boolean;
  temporalAuthority: string;
  dueDate: string | null;
  earliestLawfulDate: string | null;
  preferredStartDate: string | null;
  preferredEndDate: string | null;
  latestLawfulDate: string | null;
  hardFinishDate: string | null;
};

export type AtlasWeeklyFarmContract = {
  contractVersion: string;
  farmId: string;
  farmName: string;
  membershipId: string;
  workerKey: string;
  weekStart: string;
  weekEnd: string;
  state: string;
  weeklyFeasibilityKnown: boolean;
  capacityUsesOwnerAuthoredDayShapeOnly: boolean;
  dailyCapacity: AtlasWeeklyFarmCapacityDay[];
  plannedCapacityMinutes: number | null;
  recoveryCapacityMinutes: number | null;
  capacityAnchorRequiredDays: number;
  capacityPolicyConflictDays: number;
  requiredWorkCount: number;
  requiredEstimatedMinutes: number;
  requiredUnestimatedCount: number;
  requiredReadinessRiskCount: number;
  optionalCandidateCount: number;
  optionalCandidateEstimatedMinutes: number;
  missingPlannedCapacityMinutes: number | null;
  recoveryWouldCoverKnownShortfall: boolean | null;
  work: AtlasWeeklyFarmWorkItem[];
};

type WeeklyFarmContractResponse = { ok: true; date: string; contract: AtlasWeeklyFarmContract };

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function normalizeContract(value: unknown): AtlasWeeklyFarmContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Atlas returned an invalid Weekly Farm Contract.");
  const row = value as Record<string, unknown>;
  return {
    contractVersion: String(row.contractVersion || "worker_weekly_farm_contract_v1"),
    farmId: String(row.farmId || ""),
    farmName: String(row.farmName || ""),
    membershipId: String(row.membershipId || ""),
    workerKey: String(row.workerKey || "farm_hand"),
    weekStart: String(row.weekStart || ""),
    weekEnd: String(row.weekEnd || ""),
    state: String(row.state || "unknown"),
    weeklyFeasibilityKnown: row.weeklyFeasibilityKnown === true,
    capacityUsesOwnerAuthoredDayShapeOnly: row.capacityUsesOwnerAuthoredDayShapeOnly === true,
    dailyCapacity: Array.isArray(row.dailyCapacity) ? row.dailyCapacity as AtlasWeeklyFarmCapacityDay[] : [],
    plannedCapacityMinutes: numberOrNull(row.plannedCapacityMinutes),
    recoveryCapacityMinutes: numberOrNull(row.recoveryCapacityMinutes),
    capacityAnchorRequiredDays: integer(row.capacityAnchorRequiredDays),
    capacityPolicyConflictDays: integer(row.capacityPolicyConflictDays),
    requiredWorkCount: integer(row.requiredWorkCount),
    requiredEstimatedMinutes: integer(row.requiredEstimatedMinutes),
    requiredUnestimatedCount: integer(row.requiredUnestimatedCount),
    requiredReadinessRiskCount: integer(row.requiredReadinessRiskCount),
    optionalCandidateCount: integer(row.optionalCandidateCount),
    optionalCandidateEstimatedMinutes: integer(row.optionalCandidateEstimatedMinutes),
    missingPlannedCapacityMinutes: numberOrNull(row.missingPlannedCapacityMinutes),
    recoveryWouldCoverKnownShortfall: typeof row.recoveryWouldCoverKnownShortfall === "boolean" ? row.recoveryWouldCoverKnownShortfall : null,
    work: Array.isArray(row.work) ? row.work as AtlasWeeklyFarmWorkItem[] : [],
  };
}

function errorMessage(value: unknown) {
  if (value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string") return (value as { error: string }).error;
  return "Atlas could not load the Weekly Farm Contract.";
}

export async function readAtlasWeeklyFarmContract(serviceDate: string): Promise<AtlasWeeklyFarmContract> {
  const response = await fetch(`/api/atlas/worker-weekly-contract?date=${encodeURIComponent(serviceDate)}`, { method: "GET", cache: "no-store", credentials: "same-origin" });
  const result = await response.json() as WeeklyFarmContractResponse | { ok?: false; error?: string };
  if (!response.ok || result.ok !== true) throw new Error(errorMessage(result));
  return normalizeContract(result.contract);
}
