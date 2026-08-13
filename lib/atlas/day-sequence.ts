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

export type AtlasCuePositionBasis = "first_open" | "before_task" | "after_task" | "timed_estimate" | "unresolved";

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
  dayWindow: AtlasDaySequenceWindow | null;
  sequenceOrder: number | null;
  commitmentState: "cue";
  positionResolved: boolean;
  positionBasis: AtlasCuePositionBasis;
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

const dayWindowMinutes: Record<AtlasDaySequenceWindow, { start: number; end: number }> = {
  morning: { start: 6 * 60, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 23 * 60 },
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

function unresolvedCueItem(cue: AtlasDaySequenceCueInput): AtlasCueDaySequenceItem {
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
    positionBasis: "unresolved",
  };
}

function sortResolvedWork(left: AtlasCommittedDaySequenceItem | AtlasPotentialDaySequenceItem, right: AtlasCommittedDaySequenceItem | AtlasPotentialDaySequenceItem) {
  return windowRank[left.dayWindow] - windowRank[right.dayWindow]
    || left.sequenceOrder - right.sequenceOrder
    || (left.kind === right.kind ? 0 : left.kind === "committed_task" ? -1 : 1)
    || left.title.localeCompare(right.title);
}

function localMinuteOfDay(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function windowForMinute(minute: number): AtlasDaySequenceWindow {
  if (minute < dayWindowMinutes.afternoon.start) return "morning";
  if (minute < dayWindowMinutes.evening.start) return "afternoon";
  return "evening";
}

function orderBetween(previous: number | null, next: number | null) {
  if (previous === null && next === null) return 0;
  if (previous === null) return (next as number) - 0.5;
  if (next === null) return previous + 0.5;
  if (next > previous) return previous + ((next - previous) / 2);
  return previous + 0.001;
}

function resolveTimedCue(
  cue: AtlasDaySequenceCueInput,
  workItems: Array<AtlasCommittedDaySequenceItem | AtlasPotentialDaySequenceItem>,
): AtlasCueDaySequenceItem {
  const minute = localMinuteOfDay(cue.scheduledAt);
  if (minute === null) return unresolvedCueItem(cue);
  const dayWindow = windowForMinute(minute);
  const inWindow = workItems.filter((item) => item.dayWindow === dayWindow).sort(sortResolvedWork);
  if (!inWindow.length) {
    return {
      ...unresolvedCueItem(cue),
      dayWindow,
      sequenceOrder: 0,
      positionResolved: true,
      positionBasis: "timed_estimate",
    };
  }

  const bounds = dayWindowMinutes[dayWindow];
  const ratio = Math.max(0, Math.min(1, (minute - bounds.start) / Math.max(1, bounds.end - bounds.start)));
  const duration = (item: AtlasCommittedDaySequenceItem | AtlasPotentialDaySequenceItem) => Math.max(15, item.estimatedMinutes ?? 30);
  const totalMinutes = inWindow.reduce((sum, item) => sum + duration(item), 0);
  const target = ratio * totalMinutes;
  let consumed = 0;
  let slot = inWindow.length;

  for (let index = 0; index < inWindow.length; index += 1) {
    const itemDuration = duration(inWindow[index]);
    if (target <= consumed + (itemDuration / 2)) {
      slot = index;
      break;
    }
    if (target < consumed + itemDuration) {
      slot = index + 1;
      break;
    }
    consumed += itemDuration;
  }

  const previous = slot > 0 ? inWindow[slot - 1].sequenceOrder : null;
  const next = slot < inWindow.length ? inWindow[slot].sequenceOrder : null;
  return {
    ...unresolvedCueItem(cue),
    dayWindow,
    sequenceOrder: orderBetween(previous, next),
    positionResolved: true,
    positionBasis: "timed_estimate",
  };
}

function resolveCue(
  cue: AtlasDaySequenceCueInput,
  workItems: Array<AtlasCommittedDaySequenceItem | AtlasPotentialDaySequenceItem>,
): AtlasCueDaySequenceItem {
  if (cue.anchorKind === "first_open") {
    const first = workItems[0] ?? null;
    return {
      ...unresolvedCueItem(cue),
      dayWindow: "morning",
      sequenceOrder: first?.dayWindow === "morning" ? first.sequenceOrder - 1 : -1_000_000,
      positionResolved: true,
      positionBasis: "first_open",
    };
  }

  if (cue.anchorKind === "at_time") return resolveTimedCue(cue, workItems);

  const anchor = cue.anchorTaskId
    ? workItems.find((item) => item.kind === "committed_task" && item.taskId === cue.anchorTaskId) ?? null
    : null;
  if (!anchor) return unresolvedCueItem(cue);

  return {
    ...unresolvedCueItem(cue),
    dayWindow: anchor.dayWindow,
    sequenceOrder: anchor.sequenceOrder + (cue.anchorKind === "before_task" ? -0.01 : 0.01),
    positionResolved: true,
    positionBasis: cue.anchorKind,
  };
}

function sortSequenceItems(left: AtlasDaySequenceItem, right: AtlasDaySequenceItem) {
  if (!left.positionResolved && !right.positionResolved) return left.id.localeCompare(right.id);
  if (!left.positionResolved) return 1;
  if (!right.positionResolved) return -1;
  const leftWindow = left.dayWindow as AtlasDaySequenceWindow;
  const rightWindow = right.dayWindow as AtlasDaySequenceWindow;
  const leftOrder = left.sequenceOrder as number;
  const rightOrder = right.sequenceOrder as number;
  return windowRank[leftWindow] - windowRank[rightWindow]
    || leftOrder - rightOrder
    || (left.kind === right.kind ? 0 : left.kind === "cue" ? -1 : right.kind === "cue" ? 1 : left.kind === "committed_task" ? -1 : 1)
    || left.id.localeCompare(right.id);
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

  const cueItems = (input.cues ?? []).map((cue) => resolveCue(cue, workItems));

  return {
    contractVersion: "worker_day_sequence_v1",
    serviceDate: input.serviceDate,
    items: [...workItems, ...cueItems].sort(sortSequenceItems),
  };
}
