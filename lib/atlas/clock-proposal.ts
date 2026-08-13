import { clockLocalMinuteOfDay } from "@/lib/atlas/clock-layout";
import type { AtlasDaySequenceItem, AtlasDaySequenceWindow } from "@/lib/atlas/day-sequence";

export type AtlasClockProposalItem = Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;

export type AtlasClockProposal = {
  item: AtlasClockProposalItem;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  durationSource: "planned" | "estimate" | "planning_hold";
  reason: string[];
  conflict: boolean;
};

export type AtlasClockProposalUnresolved = {
  item: AtlasClockProposalItem;
  reason: string;
};

export type AtlasClockProposalPlan = {
  contractVersion: "atlas_clock_proposal_v1";
  proposals: AtlasClockProposal[];
  unresolved: AtlasClockProposalUnresolved[];
};

type BusyRange = {
  taskId: string;
  startMinute: number;
  endMinute: number;
  travelLocation: string | null;
};

type ProposalOptions = {
  timeZone?: string;
  serviceStartMinute?: number;
  serviceEndMinute?: number;
};

const dayWindowBounds: Record<AtlasDaySequenceWindow, { start: number; end: number }> = {
  morning: { start: 6 * 60, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 23 * 60 },
};

function open(item: AtlasClockProposalItem) {
  return item.status !== "done" && item.status !== "completed";
}

function localMinute(value: string | null, timeZone: string) {
  return clockLocalMinuteOfDay(value, timeZone);
}

function localTimeMinute(value: string | null) {
  if (!value) return null;
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function durationFor(item: AtlasClockProposalItem) {
  if (item.plannedDurationMinutes && item.plannedDurationMinutes > 0) {
    return { minutes: item.plannedDurationMinutes, source: "planned" as const };
  }
  if (item.estimatedMinutes && item.estimatedMinutes > 0) {
    return { minutes: item.estimatedMinutes, source: "estimate" as const };
  }
  return { minutes: 30, source: "planning_hold" as const };
}

function overlaps(startMinute: number, endMinute: number, busy: BusyRange[]) {
  return busy.some((range) => startMinute < range.endMinute && endMinute > range.startMinute);
}

function pushBusy(busy: BusyRange[], item: AtlasClockProposalItem, startMinute: number, endMinute: number) {
  busy.push({
    taskId: item.taskId ?? item.id,
    startMinute,
    endMinute,
    travelLocation: item.mobility.travelLocation,
  });
  busy.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
}

function nextQuarter(value: number) {
  return Math.ceil(value / 15) * 15;
}

function previousQuarter(value: number) {
  return Math.floor(value / 15) * 15;
}

function locationScore(startMinute: number, endMinute: number, location: string | null, busy: BusyRange[]) {
  if (!location) return 0;
  let score = 0;
  for (const range of busy) {
    if (range.travelLocation !== location) continue;
    const distance = Math.min(Math.abs(startMinute - range.endMinute), Math.abs(range.startMinute - endMinute));
    if (distance <= 30) score -= 1000 - distance;
  }
  return score;
}

function findForwardSlot(
  startBound: number,
  endBound: number,
  duration: number,
  busy: BusyRange[],
  location: string | null,
) {
  const candidates: Array<{ start: number; score: number }> = [];
  for (let start = nextQuarter(startBound); start + duration <= endBound; start += 15) {
    const end = start + duration;
    if (overlaps(start, end, busy)) continue;
    candidates.push({ start, score: locationScore(start, end, location, busy) + start / 10_000 });
  }
  candidates.sort((left, right) => left.score - right.score || left.start - right.start);
  return candidates[0]?.start ?? null;
}

function findBackwardSlot(
  startBound: number,
  endBound: number,
  duration: number,
  busy: BusyRange[],
) {
  for (let end = previousQuarter(endBound); end - duration >= startBound; end -= 15) {
    const start = end - duration;
    if (!overlaps(start, end, busy)) return start;
  }
  return null;
}

function boundsFor(item: AtlasClockProposalItem, timeZone: string, serviceStart: number, serviceEnd: number) {
  const dayWindow = dayWindowBounds[item.dayWindow];
  const explicitStart = localMinute(item.mobility.windowStartAt, timeZone);
  const explicitEnd = localMinute(item.mobility.windowEndAt, timeZone);
  if (explicitStart !== null || explicitEnd !== null) {
    return {
      start: Math.max(serviceStart, explicitStart ?? dayWindow.start),
      end: Math.min(serviceEnd, explicitEnd ?? dayWindow.end),
    };
  }
  return {
    start: Math.max(serviceStart, dayWindow.start),
    end: Math.min(serviceEnd, dayWindow.end),
  };
}

function proposalReason(item: AtlasClockProposalItem, source: AtlasClockProposal["durationSource"], extra?: string) {
  const reasons = [item.mobility.placementReason];
  if (source === "estimate") reasons.push("Uses Atlas's private duration estimate for this Owner-only proposal.");
  if (source === "planning_hold") reasons.push("No duration is recorded, so Atlas is holding 30 minutes for planning only.");
  if (extra) reasons.push(extra);
  return reasons;
}

function makeProposal(
  item: AtlasClockProposalItem,
  startMinute: number,
  duration: ReturnType<typeof durationFor>,
  busy: BusyRange[],
  extraReason?: string,
  forceConflict = false,
): AtlasClockProposal {
  const endMinute = startMinute + duration.minutes;
  const conflict = forceConflict || overlaps(startMinute, endMinute, busy);
  const proposal: AtlasClockProposal = {
    item,
    startMinute,
    endMinute,
    durationMinutes: duration.minutes,
    durationSource: duration.source,
    reason: proposalReason(item, duration.source, extraReason),
    conflict,
  };
  pushBusy(busy, item, startMinute, endMinute);
  return proposal;
}

export function proposeAtlasClock(
  items: AtlasClockProposalItem[],
  options: ProposalOptions = {},
): AtlasClockProposalPlan {
  const timeZone = options.timeZone ?? "America/Chicago";
  const serviceStart = options.serviceStartMinute ?? 6 * 60;
  const serviceEnd = options.serviceEndMinute ?? 23 * 60;
  const committed = items.filter(open).sort((left, right) => left.sequenceOrder - right.sequenceOrder || left.title.localeCompare(right.title));
  const busy: BusyRange[] = [];
  const anchorRanges = new Map<string, { startMinute: number; endMinute: number }>();

  for (const item of committed) {
    const startMinute = localMinute(item.plannedStartAt, timeZone);
    if (startMinute === null) continue;
    const duration = durationFor(item).minutes;
    const endMinute = startMinute + duration;
    pushBusy(busy, item, startMinute, endMinute);
    if (item.taskId) anchorRanges.set(item.taskId, { startMinute, endMinute });
  }

  const untimed = committed.filter((item) => !item.plannedStartAt);
  const proposals: AtlasClockProposal[] = [];
  const unresolved: AtlasClockProposalUnresolved[] = [];
  const pendingAnchored: AtlasClockProposalItem[] = [];

  const acceptProposal = (proposal: AtlasClockProposal) => {
    proposals.push(proposal);
    if (proposal.item.taskId) anchorRanges.set(proposal.item.taskId, { startMinute: proposal.startMinute, endMinute: proposal.endMinute });
  };

  for (const item of untimed.filter((candidate) => candidate.mobility.constraintClass === "fixed")) {
    const fixedMinute = localTimeMinute(item.mobility.fixedLocalTime)
      ?? localMinute(item.mobility.windowStartAt, timeZone);
    if (fixedMinute === null) {
      unresolved.push({ item, reason: "Atlas knows this is fixed, but no usable clock time is recorded." });
      continue;
    }
    const duration = durationFor(item);
    acceptProposal(makeProposal(item, fixedMinute, duration, busy, "Placed at the recorded fixed time.", overlaps(fixedMinute, fixedMinute + duration.minutes, busy)));
  }

  for (const item of untimed.filter((candidate) => candidate.mobility.constraintClass === "windowed")) {
    const duration = durationFor(item);
    const bounds = boundsFor(item, timeZone, serviceStart, serviceEnd);
    const startMinute = findForwardSlot(bounds.start, bounds.end, duration.minutes, busy, item.mobility.travelLocation);
    if (startMinute === null) {
      unresolved.push({ item, reason: "No open span fits inside the recorded execution window." });
      continue;
    }
    acceptProposal(makeProposal(item, startMinute, duration, busy, "Placed inside the recorded execution window."));
  }

  for (const item of untimed.filter((candidate) => candidate.mobility.constraintClass === "anchored")) pendingAnchored.push(item);

  const placeAnchored = (item: AtlasClockProposalItem) => {
    const anchorTaskId = item.mobility.anchorTaskId;
    const anchor = anchorTaskId ? anchorRanges.get(anchorTaskId) ?? null : null;
    if (!anchor) return false;
    const duration = durationFor(item);
    const gap = item.mobility.minimumGapMinutes ?? 0;
    const bounds = boundsFor(item, timeZone, serviceStart, serviceEnd);
    const startMinute = item.mobility.anchorRelation === "before"
      ? findBackwardSlot(bounds.start, Math.min(bounds.end, anchor.startMinute - gap), duration.minutes, busy)
      : findForwardSlot(Math.max(bounds.start, anchor.endMinute + gap), bounds.end, duration.minutes, busy, item.mobility.travelLocation);
    if (startMinute === null) return false;
    acceptProposal(makeProposal(item, startMinute, duration, busy, item.mobility.anchorRelation === "before" ? "Placed before its recorded anchor." : "Placed after its recorded anchor."));
    return true;
  };

  let anchoredProgress = true;
  while (anchoredProgress) {
    anchoredProgress = false;
    for (let index = pendingAnchored.length - 1; index >= 0; index -= 1) {
      if (!placeAnchored(pendingAnchored[index])) continue;
      pendingAnchored.splice(index, 1);
      anchoredProgress = true;
    }
  }

  for (const item of untimed.filter((candidate) => candidate.mobility.constraintClass === "flexible")) {
    const duration = durationFor(item);
    const bounds = boundsFor(item, timeZone, serviceStart, serviceEnd);
    const startMinute = findForwardSlot(bounds.start, bounds.end, duration.minutes, busy, item.mobility.travelLocation);
    if (startMinute === null) {
      unresolved.push({ item, reason: `No open ${item.dayWindow} span fits this committed work.` });
      continue;
    }
    const grouped = item.mobility.travelLocation && busy.some((range) => range.travelLocation === item.mobility.travelLocation && Math.min(Math.abs(startMinute - range.endMinute), Math.abs(range.startMinute - (startMinute + duration.minutes))) <= 30);
    acceptProposal(makeProposal(item, startMinute, duration, busy, grouped ? "Kept near work at the same recorded location." : "Placed in the first workable gap for its Day window."));
  }

  anchoredProgress = true;
  while (anchoredProgress && pendingAnchored.length) {
    anchoredProgress = false;
    for (let index = pendingAnchored.length - 1; index >= 0; index -= 1) {
      if (!placeAnchored(pendingAnchored[index])) continue;
      pendingAnchored.splice(index, 1);
      anchoredProgress = true;
    }
  }
  for (const item of pendingAnchored) unresolved.push({ item, reason: "Its recorded anchor does not yet have a usable Clock position." });

  return {
    contractVersion: "atlas_clock_proposal_v1",
    proposals: proposals.sort((left, right) => left.startMinute - right.startMinute || left.item.sequenceOrder - right.item.sequenceOrder),
    unresolved,
  };
}
