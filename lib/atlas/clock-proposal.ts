import { buildClockTaskRanges, clockLocalMinuteOfDay } from "@/lib/atlas/clock-layout";
import { atlasClockReservationConflicts, type AtlasClockReservation } from "@/lib/atlas/clock-reservations";
import type { AtlasDaySequenceItem, AtlasDaySequenceWindow } from "@/lib/atlas/day-sequence";

export type AtlasClockProposalDurationSource = "planned" | "estimate" | "planning_default";
export type AtlasClockProposalPlacementSource = "fixed" | "window" | "anchor" | "day_window";

export type AtlasClockProposalBlock = {
  id: string;
  taskId: string | null;
  item: Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  durationSource: AtlasClockProposalDurationSource;
  placementSource: AtlasClockProposalPlacementSource;
  reason: string;
  conflict: boolean;
};

export type AtlasClockProposalUnresolved = {
  id: string;
  taskId: string | null;
  title: string;
  reason: string;
};

export type AtlasClockProposalPlan = {
  blocks: AtlasClockProposalBlock[];
  unresolved: AtlasClockProposalUnresolved[];
};

type PlanningReservation = {
  kind: "point" | "span";
  start: number;
  end: number;
  dayReservation?: AtlasClockReservation;
};
type CommittedItem = Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;

const dayWindowBounds: Record<AtlasDaySequenceWindow, { start: number; end: number }> = {
  morning: { start: 6 * 60, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 23 * 60 },
};

const constraintRank = { fixed: 0, windowed: 1, flexible: 2, anchored: 3 } as const;

function openTask(item: CommittedItem) { return item.status !== "done" && item.status !== "completed"; }
function durationFor(item: CommittedItem) {
  if (item.plannedDurationMinutes && item.plannedDurationMinutes > 0) return { minutes: item.plannedDurationMinutes, source: "planned" as const };
  if (item.estimatedMinutes && item.estimatedMinutes > 0) return { minutes: item.estimatedMinutes, source: "estimate" as const };
  return { minutes: 30, source: "planning_default" as const };
}
function localTimeMinute(value: string | null) { if (!value) return null; const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; }
function reservationConflict(start: number, end: number, reservation: PlanningReservation) {
  if (reservation.dayReservation) return atlasClockReservationConflicts(start, end, reservation.dayReservation);
  return start < reservation.end && end > reservation.start;
}
function conflictsAny(start: number, end: number, reservations: PlanningReservation[]) {
  return reservations.some((reservation) => reservationConflict(start, end, reservation));
}
function firstFree(start: number, end: number, duration: number, reservations: PlanningReservation[]) {
  if (duration <= 0 || start + duration > end) return null;
  const candidates = new Set<number>([start]);
  for (const reservation of reservations) {
    const candidate = reservation.kind === "point" ? reservation.start : reservation.end;
    if (candidate >= start && candidate + duration <= end) candidates.add(candidate);
  }
  for (const candidate of [...candidates].sort((left, right) => left - right)) {
    if (!conflictsAny(candidate, candidate + duration, reservations)) return candidate;
  }
  return null;
}
function lastFree(start: number, end: number, duration: number, reservations: PlanningReservation[]) {
  if (duration <= 0 || end - duration < start) return null;
  const candidates = new Set<number>([end - duration]);
  for (const reservation of reservations) {
    const boundary = reservation.start;
    const candidate = boundary - duration;
    if (candidate >= start && candidate + duration <= end) candidates.add(candidate);
  }
  for (const candidate of [...candidates].sort((left, right) => right - left)) {
    if (!conflictsAny(candidate, candidate + duration, reservations)) return candidate;
  }
  return null;
}
function flexibleSearchWindows(item: CommittedItem): AtlasDaySequenceWindow[] {
  if (item.mobility.intradayPreference !== "cool_morning_or_evening") return [item.dayWindow];
  const preferred: AtlasDaySequenceWindow[] = item.dayWindow === "evening"
    ? ["evening", "morning"]
    : ["morning", "evening"];
  return [...preferred, ...(["morning", "afternoon", "evening"] as AtlasDaySequenceWindow[]).filter((window) => !preferred.includes(window))];
}
function firstFlexibleFree(item: CommittedItem, duration: number, reservations: PlanningReservation[]) {
  for (const window of flexibleSearchWindows(item)) {
    const bounds = dayWindowBounds[window];
    const start = firstFree(bounds.start, bounds.end, duration, reservations);
    if (start !== null) return { start, window };
  }
  return null;
}
function reserve(block: AtlasClockProposalBlock, reservations: PlanningReservation[]) { reservations.push({ kind: "span", start: block.startMinute, end: block.endMinute }); }
function proposal(item: CommittedItem, startMinute: number, durationMinutes: number, durationSource: AtlasClockProposalDurationSource, placementSource: AtlasClockProposalPlacementSource, reason: string, conflict: boolean): AtlasClockProposalBlock {
  return { id: `clock-proposal:${item.id}`, taskId: item.taskId, item, startMinute, endMinute: startMinute + durationMinutes, durationMinutes, durationSource, placementSource, reason, conflict };
}
function anchorRange(anchorTaskId: string, committedByTask: Map<string, CommittedItem>, existingByTask: Map<string, { startMinute: number; endMinute: number }>, proposalByTask: Map<string, AtlasClockProposalBlock>) {
  const proposed = proposalByTask.get(anchorTaskId); if (proposed) return { startMinute: proposed.startMinute, endMinute: proposed.endMinute };
  const existing = existingByTask.get(anchorTaskId); if (existing) return existing;
  const anchor = committedByTask.get(anchorTaskId); if (!anchor?.plannedStartAt) return null;
  const startMinute = clockLocalMinuteOfDay(anchor.plannedStartAt); if (startMinute === null) return null;
  const duration = anchor.plannedDurationMinutes ?? anchor.estimatedMinutes ?? 0;
  return { startMinute, endMinute: startMinute + duration };
}

export function buildAtlasClockProposal(
  items: CommittedItem[],
  options: { reservations?: AtlasClockReservation[] } = {},
): AtlasClockProposalPlan {
  const committed = items.filter(openTask);
  const existingRanges = buildClockTaskRanges(committed, { allowPrivateEstimate: true });
  const reservations: PlanningReservation[] = [
    ...existingRanges.map((range) => ({ kind: "span" as const, start: range.startMinute, end: range.endMinute > range.startMinute ? range.endMinute : range.startMinute + 15 })),
    ...(options.reservations ?? []).map((reservation) => ({ kind: reservation.kind, start: reservation.startMinute, end: reservation.endMinute, dayReservation: reservation })),
  ];
  const existingByTask = new Map(existingRanges.filter((range) => range.item.taskId).map((range) => [range.item.taskId as string, { startMinute: range.startMinute, endMinute: range.endMinute }]));
  const committedByTask = new Map(committed.filter((item) => item.taskId).map((item) => [item.taskId as string, item]));
  const proposalByTask = new Map<string, AtlasClockProposalBlock>();
  const blocks: AtlasClockProposalBlock[] = [];
  const unresolved: AtlasClockProposalUnresolved[] = [];
  const untimed = committed.filter((item) => !item.plannedStartAt).sort((left, right) => constraintRank[left.mobility.constraintClass] - constraintRank[right.mobility.constraintClass] || left.sequenceOrder - right.sequenceOrder || left.title.localeCompare(right.title));

  for (const item of untimed) {
    if (item.mobility.constraintClass === "anchored") continue;
    const duration = durationFor(item); const mobility = item.mobility; let block: AtlasClockProposalBlock | null = null;
    if (mobility.constraintClass === "fixed") {
      const start = localTimeMinute(mobility.fixedLocalTime) ?? clockLocalMinuteOfDay(mobility.windowStartAt);
      if (start === null) { unresolved.push({ id: item.id, taskId: item.taskId, title: item.title, reason: "Fixed timing is recorded, but Atlas cannot resolve its local clock time." }); continue; }
      const conflict = conflictsAny(start, start + duration.minutes, reservations);
      block = proposal(item, start, duration.minutes, duration.source, "fixed", "Uses the task's recorded fixed clock constraint.", conflict);
    } else if (mobility.constraintClass === "windowed") {
      const startBound = clockLocalMinuteOfDay(mobility.windowStartAt) ?? dayWindowBounds[item.dayWindow].start;
      const endBound = clockLocalMinuteOfDay(mobility.windowEndAt) ?? dayWindowBounds[item.dayWindow].end;
      const start = firstFree(startBound, endBound, duration.minutes, reservations);
      if (start === null) { unresolved.push({ id: item.id, taskId: item.taskId, title: item.title, reason: "No open span currently fits inside the recorded execution window and day reservations." }); continue; }
      block = proposal(item, start, duration.minutes, duration.source, "window", "Fits inside the task's recorded execution window without crossing a real day reservation.", false);
    } else {
      const placement = firstFlexibleFree(item, duration.minutes, reservations);
      if (placement === null) { unresolved.push({ id: item.id, taskId: item.taskId, title: item.title, reason: `No open ${item.dayWindow} or preferred intraday span currently fits this work around the real day reservations.` }); continue; }
      const prefersCoolWork = mobility.intradayPreference === "cool_morning_or_evening";
      const inPreferredCoolWindow = prefersCoolWork && (placement.window === "morning" || placement.window === "evening");
      const reason = inPreferredCoolWindow
        ? `Honors the task's recorded cool-morning-or-evening preference in the ${placement.window} without crossing a recorded Clock commitment or day reservation.`
        : prefersCoolWork
          ? `No preferred cool-work span fit, so Atlas used the existing ${placement.window} Day window without crossing a recorded Clock commitment or day reservation.`
          : `Fits the existing ${item.dayWindow} Day order without crossing a recorded Clock commitment or day reservation.`;
      block = proposal(item, placement.start, duration.minutes, duration.source, "day_window", reason, false);
    }
    blocks.push(block); reserve(block, reservations); if (item.taskId) proposalByTask.set(item.taskId, block);
  }

  for (const item of untimed.filter((candidate) => candidate.mobility.constraintClass === "anchored")) {
    const duration = durationFor(item); const mobility = item.mobility;
    if (!mobility.anchorTaskId || !mobility.anchorRelation) { unresolved.push({ id: item.id, taskId: item.taskId, title: item.title, reason: "Atlas knows this work is anchored, but the recorded anchor is incomplete." }); continue; }
    const anchor = anchorRange(mobility.anchorTaskId, committedByTask, existingByTask, proposalByTask);
    if (!anchor) { unresolved.push({ id: item.id, taskId: item.taskId, title: item.title, reason: "Its recorded anchor has no Clock position yet, so Atlas is leaving this work unplaced." }); continue; }
    const gap = mobility.minimumGapMinutes ?? 0; const bounds = dayWindowBounds[item.dayWindow];
    const start = mobility.anchorRelation === "before" ? lastFree(bounds.start, anchor.startMinute - gap, duration.minutes, reservations) : firstFree(anchor.endMinute + gap, bounds.end, duration.minutes, reservations);
    if (start === null) { unresolved.push({ id: item.id, taskId: item.taskId, title: item.title, reason: `No open span fits ${mobility.anchorRelation} its recorded anchor without breaking another Clock commitment or day reservation.` }); continue; }
    const block = proposal(item, start, duration.minutes, duration.source, "anchor", `Stays ${mobility.anchorRelation} its recorded anchor${gap ? ` with a ${gap}-minute gap` : ""} and respects real day reservations.`, false);
    blocks.push(block); reserve(block, reservations); if (item.taskId) proposalByTask.set(item.taskId, block);
  }
  return { blocks: blocks.sort((left, right) => left.startMinute - right.startMinute || left.item.sequenceOrder - right.item.sequenceOrder), unresolved };
}
