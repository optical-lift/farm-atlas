export type AtlasDaySequenceWindow = "morning" | "afternoon" | "evening";

export type AtlasDaySequencePlanRowInput = {
  id: string;
  kind?: "real" | "automatic" | "suggestion" | string;
  sourceKind: string;
  sourceId: string;
  taskId?: string | null;
  title: string;
  note?: string | null;
  status?: string | null;
  environment?: string | null;
  location?: string | null;
  expectedActiveMinutes?: number | null;
  dayWindow: AtlasDaySequenceWindow;
  workOrderNumber: number;
  automatic?: boolean;
  requiresOwnerApproval?: boolean;
  conditional?: boolean;
  recommended?: boolean;
  reason?: string | null;
  commitmentKind?: string | null;
  preferredWindowStart?: string | null;
  preferredWindowEnd?: string | null;
  safeWindowEnd?: string | null;
  timingWarning?: string | null;
};

export type AtlasDaySequenceCueInput = {
  cueId: string;
  serviceDate: string;
  cueKind: string;
  anchorKind: "first_open" | "before_task" | "after_task" | "at_time";
  anchorTaskId: string | null;
  scheduledAt: string | null;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
  status: string;
  recoveryPolicy?: string;
  availableFrom?: string | null;
  expiresAt?: string | null;
};

export type AtlasCommittedDaySequenceItem = {
  kind: "committed_task";
  id: string;
  sourceRowId: string;
  sourceKind: string;
  sourceId: string;
  taskId: string | null;
  title: string;
  note: string | null;
  status: string | null;
  location: string | null;
  environment: string | null;
  estimatedMinutes: number | null;
  dayWindow: AtlasDaySequenceWindow;
  sequenceOrder: number;
  commitmentState: "committed";
  automatic: boolean;
  reason: string | null;
  commitmentKind: string | null;
  preferredWindowStart: string | null;
  preferredWindowEnd: string | null;
  safeWindowEnd: string | null;
  timingWarning: string | null;
  positionResolved: true;
};

export type AtlasPotentialDaySequenceItem = {
  kind: "potential_task";
  id: string;
  sourceRowId: string;
  sourceKind: string;
  sourceId: string;
  taskId: string | null;
  title: string;
  note: string | null;
  status: string | null;
  location: string | null;
  environment: string | null;
  estimatedMinutes: number | null;
  dayWindow: AtlasDaySequenceWindow;
  sequenceOrder: number;
  commitmentState: "potential";
  conditional: boolean;
  recommended: boolean;
  reason: string | null;
  commitmentKind: string | null;
  preferredWindowStart: string | null;
  preferredWindowEnd: string | null;
  safeWindowEnd: string | null;
  timingWarning: string | null;
  projectionEligible: boolean;
  positionResolved: true;
};

export type AtlasCueDaySequenceItem = {
  kind: "cue";
  id: string;
  cueId: string;
  cueKind: string;
  anchorKind: AtlasDaySequenceCueInput["anchorKind"];
  anchorTaskId: string | null;
  scheduledAt: string | null;
  title: string;
  body: string | null;
  status: string;
  dayWindow: null;
  sequenceOrder: null;
  commitmentState: "cue";
  positionResolved: false;
};

export type AtlasDaySequenceItem =
  | AtlasCommittedDaySequenceItem
  | AtlasPotentialDaySequenceItem
  | AtlasCueDaySequenceItem;

export type AtlasDaySequence = {
  contractVersion: "worker_day_sequence_v1";
  serviceDate: string;
  items: AtlasDaySequenceItem[];
};

type AssembleWorkerDaySequenceInput = {
  serviceDate: string;
  realWork?: AtlasDaySequencePlanRowInput[];
  automaticWork?: AtlasDaySequencePlanRowInput[];
  suggestions?: AtlasDaySequencePlanRowInput[];
  cues?: AtlasDaySequenceCueInput[];
};

const windowRank: Record<AtlasDaySequenceWindow, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
};

function minutes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return Math.max(0, Math.round(Number(value)));
}

function text(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value : null;
}

function workIdentity(row: AtlasDaySequencePlanRowInput) {
  return row.taskId ? `task:${row.taskId}` : `${row.sourceKind}:${row.sourceId || row.id}`;
}

function committedItem(row: AtlasDaySequencePlanRowInput): AtlasCommittedDaySequenceItem {
  return {
    kind: "committed_task",
    id: workIdentity(row),
    sourceRowId: row.id,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    taskId: row.taskId ?? null,
    title: row.title,
    note: text(row.note),
    status: text(row.status),
    location: text(row.location),
    environment: text(row.environment),
    estimatedMinutes: minutes(row.expectedActiveMinutes),
    dayWindow: row.dayWindow,
    sequenceOrder: Number(row.workOrderNumber) || 0,
    commitmentState: "committed",
    automatic: row.kind === "automatic" || row.automatic === true,
    reason: text(row.reason),
    commitmentKind: text(row.commitmentKind),
    preferredWindowStart: text(row.preferredWindowStart),
    preferredWindowEnd: text(row.preferredWindowEnd),
    safeWindowEnd: text(row.safeWindowEnd),
    timingWarning: text(row.timingWarning),
    positionResolved: true,
  };
}

function potentialItem(row: AtlasDaySequencePlanRowInput): AtlasPotentialDaySequenceItem {
  return {
    kind: "potential_task",
    id: `potential:${row.sourceKind}:${row.sourceId || row.id}`,
    sourceRowId: row.id,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    taskId: row.taskId ?? null,
    title: row.title,
    note: text(row.note),
    status: text(row.status),
    location: text(row.location),
    environment: text(row.environment),
    estimatedMinutes: minutes(row.expectedActiveMinutes),
    dayWindow: row.dayWindow,
    sequenceOrder: Number(row.workOrderNumber) || 0,
    commitmentState: "potential",
    conditional: row.conditional === true,
    recommended: row.recommended !== false,
    reason: text(row.reason),
    commitmentKind: text(row.commitmentKind),
    preferredWindowStart: text(row.preferredWindowStart),
    preferredWindowEnd: text(row.preferredWindowEnd),
    safeWindowEnd: text(row.safeWindowEnd),
    timingWarning: text(row.timingWarning),
    projectionEligible: row.sourceKind === "project_pull" || row.sourceKind === "floating_task",
    positionResolved: true,
  };
}

function cueItem(cue: AtlasDaySequenceCueInput): AtlasCueDaySequenceItem {
  return {
    kind: "cue",
    id: `cue:${cue.cueId}`,
    cueId: cue.cueId,
    cueKind: cue.cueKind,
    anchorKind: cue.anchorKind,
    anchorTaskId: cue.anchorTaskId,
    scheduledAt: cue.scheduledAt,
    title: cue.title,
    body: text(cue.body),
    status: cue.status,
    dayWindow: null,
    sequenceOrder: null,
    commitmentState: "cue",
    positionResolved: false,
  };
}

function sortResolvedWork(left: AtlasCommittedDaySequenceItem | AtlasPotentialDaySequenceItem, right: AtlasCommittedDaySequenceItem | AtlasPotentialDaySequenceItem) {
  return windowRank[left.dayWindow] - windowRank[right.dayWindow]
    || left.sequenceOrder - right.sequenceOrder
    || (left.kind === right.kind ? 0 : left.kind === "committed_task" ? -1 : 1)
    || left.title.localeCompare(right.title);
}

export function assembleWorkerDaySequence(input: AssembleWorkerDaySequenceInput): AtlasDaySequence {
  const committedByIdentity = new Map<string, AtlasCommittedDaySequenceItem>();
  for (const row of [...(input.realWork ?? []), ...(input.automaticWork ?? [])]) {
    const item = committedItem(row);
    if (!committedByIdentity.has(item.id)) committedByIdentity.set(item.id, item);
  }

  const workItems = [
    ...Array.from(committedByIdentity.values()),
    ...(input.suggestions ?? []).map(potentialItem),
  ].sort(sortResolvedWork);

  // Pass 2 establishes one typed Day read model. Cue anchors are deliberately left
  // unresolved here; Pass 3 owns the deterministic before/after/time insertion rules.
  const cueItems = (input.cues ?? []).map(cueItem);

  return {
    contractVersion: "worker_day_sequence_v1",
    serviceDate: input.serviceDate,
    items: [...workItems, ...cueItems],
  };
}
