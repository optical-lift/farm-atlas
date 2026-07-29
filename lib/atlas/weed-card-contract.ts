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
  cropLabel: string;
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
