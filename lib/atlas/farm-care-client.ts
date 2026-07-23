export type CareState =
  | "settled"
  | "stirring"
  | "needs_tending"
  | "losing_shape"
  | "recovery_needed"
  | "resting"
  | "suppressed"
  | "decision_needed"
  | "unknown";

export type CareTrend = "improving" | "stable" | "rising" | "unknown";

export type StateCounts = {
  settled: number;
  stirring: number;
  needsTending: number;
  losingShape: number;
  recoveryNeeded: number;
  resting: number;
  suppressed: number;
  decisionNeeded: number;
  unknown: number;
};

export type StrategySummary = {
  strategy: string;
  label: string;
  objectCount: number;
};

export type ReleasedIntervention = {
  taskId: string;
  title: string;
  status: string;
  dueDate?: string;
  objectIds?: string[];
  estimatedMinutes?: number;
  action?: string;
  subject?: string;
  lane?: string;
  reasonLines?: string[];
  desiredResult?: string;
  doneDefinition?: string;
  unlocks?: string;
};

export type PlannedRecommendation = {
  occurrenceId: string;
  objectId?: string;
  title: string;
  plannedDueDate?: string;
  notBeforeDate?: string;
  state: string;
  estimatedMinutes?: number;
  desiredResult?: string;
  doneDefinition?: string;
  source?: string;
};

export type CareHistoryEvent = {
  historyId: string;
  occurredAt: string;
  objectId?: string;
  objectKey?: string;
  objectLabel?: string;
  previousState?: CareState;
  previousStateLabel?: string;
  resultingState?: CareState;
  resultingStateLabel?: string;
  previousStrategy?: string;
  previousStrategyLabel?: string;
  resultingStrategy?: string;
  resultingStrategyLabel?: string;
  sourceKind?: string;
  reason?: unknown;
};

export type MaintenanceResult = {
  maintenanceHistoryId: string;
  completedAt: string;
  outcome?: string;
  conditionBefore?: string;
  conditionAfter?: string;
  estimatedMinutesBefore?: number;
  actualMinutes?: number;
  remainingMinutesAfter?: number;
  sourceTaskId?: string;
  note?: string;
};

export type CareObservation = {
  observationId: string;
  observedAt: string;
  pressure?: string;
  intendedShapeReadable?: boolean;
  functionProtected?: boolean;
  recoveryRequired?: boolean;
  estimatedEffortMinutes?: number;
  note?: string;
  sourceKind?: string;
};

export type ObjectContent = {
  contentId: string;
  label: string;
  type?: string;
  variety?: string;
  status?: string;
  plantedDate?: string;
  confidence?: string;
  startMethod?: string;
  germinatedDate?: string;
  bloomStartDate?: string;
  expectedHarvestWatchStart?: string;
  expectedClearDate?: string;
  nextCropPlanned?: string;
};

export type CropCycle = {
  cropCycleId: string;
  cropCycleKey?: string;
  crop: string;
  variety?: string;
  state?: string;
  lifecycleStatus?: string;
  sownDate?: string;
  plantedDate?: string;
  expectedHarvestWatchStart?: string;
  expectedClearDate?: string;
};

export type FarmCareObject = {
  farmId?: string;
  zoneId?: string;
  zoneKey: string;
  zoneLabel: string;
  zoneType?: string;
  zoneMode?: string;
  zonePurpose?: string;
  intendedFinish?: string;
  zoneVisibleToGuests?: boolean;
  objectId: string;
  objectKey: string;
  objectLabel: string;
  objectType: string;
  objectMode?: string;
  guestVisible?: boolean;
  careState: CareState;
  careStateLabel: string;
  careStrategy: string;
  careStrategyLabel: string;
  carePressure?: string;
  careTrend: CareTrend;
  careTrendLabel: string;
  careFreshness?: string;
  careConfidence?: string;
  observedAt?: string;
  observationAgeDays?: number;
  reviewOn?: string;
  estimatedEffortMinutes?: number;
  lastMeaningfullyTendedAt?: string;
  lastStateTransitionAt?: string;
  ordinaryWeedingAllowed?: boolean;
  contents: ObjectContent[];
  activeCropCycles: CropCycle[];
  riskLabels: string[];
  productionSensitive?: boolean;
  guestSensitive?: boolean;
  accessOrEstablishmentSensitive?: boolean;
  spreadSensitive?: boolean;
  releasedInterventionCount: number;
  releasedEffortMinutes?: number;
  releasedInterventions: ReleasedIntervention[];
  plannedRecommendationCount: number;
  plannedEffortMinutes?: number;
  plannedRecommendations: PlannedRecommendation[];
  now: string;
  desiredAfter: string;
  doneDefinition: string;
  nextValidAction: string;
  evidence?: {
    sourceKind?: string;
    strategySource?: string;
    reason?: unknown;
    updatedAt?: string;
  };
  latestObservation?: CareObservation | null;
  history?: CareHistoryEvent[];
  results?: MaintenanceResult[];
};

export type HighestConcernObject = Pick<
  FarmCareObject,
  "objectId" | "objectKey" | "objectLabel" | "careState" | "careStateLabel" | "nextValidAction"
> & { estimatedEffortMinutes?: number };

export type FarmCareZone = {
  zoneId: string;
  zoneKey: string;
  zoneLabel: string;
  zoneType: string;
  zoneMode: string;
  purpose?: string;
  intendedFinish?: string;
  visibleToGuests: boolean;
  sortOrder: number;
  careState: CareState;
  careStateLabel: string;
  careTrend: CareTrend;
  careTrendLabel: string;
  objectCount: number;
  stateCounts: StateCounts;
  observationCoverage: {
    reliable: number;
    stale: number;
    unknownOrStale: number;
    oldestReliableObservation?: string;
  };
  estimatedCareMinutes: number;
  estimatedRecoveryMinutes: number;
  risks: {
    production: number;
    presentation: number;
    accessOrEstablishment: number;
    spread: number;
  };
  highestConcernObject?: HighestConcernObject;
  strategySummary: StrategySummary[];
  releasedInterventionCount: number;
  plannedRecommendationCount: number;
  decisionRequired: boolean;
  nextMove?: string;
  objectGroups?: Partial<Record<CareState, FarmCareObject[]>>;
  releasedInterventions?: ReleasedIntervention[];
  plannedRecommendations?: PlannedRecommendation[];
  history?: CareHistoryEvent[];
};

export type RecentWin = {
  historyId: string;
  occurredAt: string;
  zoneLabel?: string;
  objectLabel: string;
  previousStateLabel?: string;
  resultingStateLabel: string;
  reason?: string;
};

export type FarmCareSummary = {
  contractVersion: string;
  farm: {
    farmId: string;
    farmKey: string;
    farmName: string;
    status: string;
  };
  generatedAt: string;
  summarySentence: string;
  objectCount: number;
  zoneCount: number;
  stateCounts: StateCounts;
  statePercentages: StateCounts;
  zoneTrends: {
    improving: number;
    holding: number;
    rising: number;
    unknown: number;
    recoveryZones: number;
  };
  observationCoverage: {
    observed: number;
    estimated: number;
    stale: number;
    unknown: number;
    needsObservation: number;
    coveredPercent: number;
  };
  effort: {
    tendingMinutes: number;
    recoveryMinutes: number;
    knownCareMinutes: number;
    releasedMinutes: number;
    plannedMinutes: number;
  };
  concerns: {
    production: number;
    guestPresentation: number;
    accessOrEstablishment: number;
    spread: number;
    resting: number;
    suppressed: number;
    decisionNeeded: number;
  };
  releasedInterventionCount: number;
  plannedRecommendationCount: number;
  recentWins: RecentWin[];
  zones: FarmCareZone[];
};

export type FarmCareRead<T> = {
  ok: boolean;
  role?: string;
  farmKey?: string;
  error?: string;
} & T;

export const CARE_STATE_ROWS: Array<{
  key: keyof StateCounts;
  state: CareState;
  label: string;
  quietLabel: string;
}> = [
  { key: "settled", state: "settled", label: "Settled", quietLabel: "holding well" },
  { key: "stirring", state: "stirring", label: "Stirring", quietLabel: "early pressure" },
  { key: "needsTending", state: "needs_tending", label: "Needs tending", quietLabel: "light care" },
  { key: "losingShape", state: "losing_shape", label: "Losing shape", quietLabel: "shape at risk" },
  { key: "recoveryNeeded", state: "recovery_needed", label: "Recovery needed", quietLabel: "focused recovery" },
  { key: "resting", state: "resting", label: "Resting", quietLabel: "intentionally paused" },
  { key: "suppressed", state: "suppressed", label: "Suppressed", quietLabel: "held by strategy" },
  { key: "decisionNeeded", state: "decision_needed", label: "Decision needed", quietLabel: "management choice" },
  { key: "unknown", state: "unknown", label: "Unknown", quietLabel: "needs observation" },
];

export function careStateClass(state: CareState) {
  return state.replaceAll("_", "-");
}

export function prettyCareDate(value: string | null | undefined, includeYear = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

export function formatCareMinutes(minutes: number | null | undefined) {
  const safe = Math.max(0, Math.round(minutes ?? 0));
  if (safe === 0) return "No known effort";
  if (safe < 60) return `${safe} min`;
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function humanizeCareValue(value: string | null | undefined) {
  if (!value) return "Not recorded";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function readPrepared<T>(url: string): Promise<FarmCareRead<T>> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = (await response.json()) as FarmCareRead<T>;
  if (!response.ok || !result.ok) throw new Error(result.error || "Farm Care failed to load.");
  return result;
}

export function fetchFarmCareSummary() {
  return readPrepared<{ care?: FarmCareSummary }>("/api/atlas/farm-care");
}

export function fetchFarmCareZone(zoneKey: string) {
  return readPrepared<{ zone?: FarmCareZone }>(`/api/atlas/farm-care/zone?zoneKey=${encodeURIComponent(zoneKey)}`);
}

export function fetchFarmCareObject(objectKey: string) {
  return readPrepared<{ object?: FarmCareObject }>(`/api/atlas/farm-care/object?objectKey=${encodeURIComponent(objectKey)}`);
}
