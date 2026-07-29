export type AtlasWeedCondition = "heavy" | "medium_pressure" | "row_readable" | "mostly_clear" | "clear";

export type AtlasWeedSession = {
  id: string;
  workDate: string;
  minutes: number;
  minutesKnown: boolean;
  conditionBefore: AtlasWeedCondition;
  conditionAfter: AtlasWeedCondition;
  note: string | null;
  recordedAt: string;
};

export type AtlasCropOccupancyCohort = {
  cropCycleId: string;
  cropLabel: string;
  displayLabel: string;
  variety?: string | null;
  lifeCycle: string;
  establishmentDate?: string | null;
  dateSource: string;
  stage?: string | null;
  stageLabel: string;
  placementId?: string | null;
  placementMode?: string | null;
  placementLabel?: string | null;
  placementSummary?: string | null;
  rowCount?: number | null;
  rowLengthFt?: number | null;
  areaSqft?: number | null;
  cellCount?: number | null;
  spacingIn?: number | null;
  plantsPerSqft?: number | null;
  expectedQuantity?: number | null;
  expectedQuantityKind?: "recorded" | "calculated" | "unknown" | null;
  expectedQuantityUnit?: string | null;
  expectedQuantityBasis?: string | null;
  observedQuantity?: number | null;
  observedQuantityUnit?: string | null;
  observedQuantityKind?: string | null;
  observedQuantityDate?: string | null;
  standPercent?: number | null;
  condition?: string | null;
  confidence: string;
};

export type AtlasCropOccupancyGroup = {
  groupKind: "dated" | "observed" | "perennial" | "unknown";
  groupDate: string | null;
  groupLabel: string;
  cohorts: AtlasCropOccupancyCohort[];
};

export type AtlasMapEdge = "north" | "south" | "east" | "west";

export type AtlasBedMapPlacement = {
  placementId: string;
  cropCycleId: string;
  displayLabel: string;
  stage?: string | null;
  stageLabel: string;
  lifeCycle: string;
  placementMode?: string | null;
  placementLabel?: string | null;
  rowCount?: number | null;
  rowLengthFt?: number | null;
  areaSqft?: number | null;
  explicitPlantCount?: number | null;
  clumpCount?: number | null;
  expectedQuantity?: number | null;
  expectedQuantityKind?: "recorded" | "calculated" | "unknown" | null;
  observedQuantity?: number | null;
  observedQuantityUnit?: string | null;
  standPercent?: number | null;
  anchorEdge?: AtlasMapEdge | null;
  longStartFt?: number | null;
  longEndFt?: number | null;
  crossStartFt?: number | null;
  crossEndFt?: number | null;
  positionConfidence: "unknown" | "low" | "medium" | "high";
};

export type AtlasBedMap = {
  objectId: string;
  objectKey: string;
  objectLabel: string;
  lengthFt: number | null;
  widthFt: number | null;
  orientationKnown: boolean;
  longAxis: "north_south" | "east_west" | "unknown";
  leftEdge: AtlasMapEdge | null;
  rightEdge: AtlasMapEdge | null;
  topEdge: AtlasMapEdge | null;
  bottomEdge: AtlasMapEdge | null;
  orientationSource?: string | null;
  placements: AtlasBedMapPlacement[];
};

export type AtlasWeedCardContext = {
  taskId: string;
  taskStatus: string;
  taskDueDate: string | null;
  cardId: string;
  passId: string | null;
  passStatus: "active" | "closed";
  objectId: string;
  objectKey: string;
  objectLabel: string;
  zoneLabel: string;
  occupancyGroups: AtlasCropOccupancyGroup[];
  bedMap?: AtlasBedMap | null;
  condition: AtlasWeedCondition;
  targetCondition: AtlasWeedCondition;
  totalMinutes: number;
  sessionCount: number;
  nextReviewOn: string | null;
  sessions: AtlasWeedSession[];
};

export type AtlasWeedCardSessionInput = {
  taskId: string;
  minutes?: number | null;
  conditionAfter: AtlasWeedCondition;
  workDate: string;
  note?: string;
  idempotencyKey?: string;
};

export type AtlasWeedCardSessionResult = {
  sessionId: string;
  taskId: string;
  nextTaskId: string | null;
  cardId: string;
  passId: string;
  minutes: number;
  minutesKnown: boolean;
  conditionAfter: AtlasWeedCondition;
  passClosed: boolean;
  taskClosed: boolean;
  nextReviewOn: string | null;
  deduplicated: boolean;
};

export type AtlasFinishWeedCardDayInput = {
  taskId: string;
  workDate: string;
  idempotencyKey?: string;
};

export type AtlasFinishWeedCardDayResult = {
  taskId: string;
  nextTaskId: string | null;
  cardId?: string;
  passId?: string | null;
  conditionAfter?: AtlasWeedCondition;
  passClosed?: boolean;
  taskClosed: boolean;
  deduplicated: boolean;
};

export const ATLAS_WEED_CONDITIONS: AtlasWeedCondition[] = [
  "heavy",
  "medium_pressure",
  "row_readable",
  "mostly_clear",
  "clear",
];

export const ATLAS_WEED_CONDITION_LABELS: Record<AtlasWeedCondition, string> = {
  heavy: "Heavy pressure",
  medium_pressure: "Medium pressure",
  row_readable: "Row readable",
  mostly_clear: "Mostly clear",
  clear: "Clear",
};