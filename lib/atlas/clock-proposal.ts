import type { AtlasCommittedClockItem, AtlasClockTaskRange } from "@/lib/atlas/clock-layout";
import { clockLocalMinuteOfDay, clockSpanForTask } from "@/lib/atlas/clock-layout";

export type AtlasClockProposal = {
  item: AtlasCommittedClockItem;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  reason: string;
};

type MinuteWindow = { start: number; end: number };

const DAYPARTS: Record<string, MinuteWindow> = {
  morning: { start: 8 * 60, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 20 * 60 },
};

function localTimeMinute(value: string | null) {
  if (!value) return null;
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function occupied(ranges: AtlasClockTaskRange[], proposals: AtlasClockProposal[]) {
  return [
    ...ranges.filter((range) => range.span.minutes).map((range) => ({ start: range.startMinute, end: range.endMinute })),
    ...proposals.map((proposal) => ({ start: proposal.startMinute, end: proposal.endMinute })),
  ].sort((left, right) => left.start - right.start);
}

function firstFit(window: MinuteWindow, duration: number, blocked: MinuteWindow[]) {
  let cursor = window.start;
  for (const range of blocked) {
    if (range.end <= cursor) continue;
    if (range.start >= window.end) break;
    if (range.start - cursor >= duration) return cursor;
    cursor = Math.max(cursor, range.end);
    if (cursor + duration > window.end) return null;
  }
  return cursor + duration <= window.end ? cursor : null;
}

function itemDuration(item: AtlasCommittedClockItem) {
  return Math.max(15, clockSpanForTask(item, true).minutes ?? 30);
}

function itemWindow(item: AtlasCommittedClockItem) {
  const start = clockLocalMinuteOfDay(item.mobility.windowStartAt);
  const end = clockLocalMinuteOfDay(item.mobility.windowEndAt);
  if (start !== null || end !== null) return { start: start ?? 6 * 60, end: end ?? 22 * 60 };
  return DAYPARTS[item.dayWindow ?? "morning"] ?? DAYPARTS.morning;
}

export function buildAtlasClockProposals(committed: AtlasCommittedClockItem[], existingRanges: AtlasClockTaskRange[]) {
  const proposals: AtlasClockProposal[] = [];
  const byTaskId = new Map(committed.filter((item) => item.taskId).map((item) => [item.taskId as string, item]));
  const rangeByItemId = new Map(existingRanges.map((range) => [range.item.id, range]));

  for (const item of committed.filter((candidate) => !candidate.plannedStartAt && candidate.status !== "done" && candidate.status !== "completed")) {
    const duration = itemDuration(item);
    const mobility = item.mobility;
    const blocked = occupied(existingRanges, proposals);
    let start: number | null = null;
    let reason = "Fits the open part of its Day window.";

    if (mobility.constraintClass === "fixed") {
      start = localTimeMinute(mobility.fixedLocalTime);
      reason = "Uses the exact time already recorded for this work.";
    } else if (mobility.constraintClass === "anchored" && mobility.anchorTaskId) {
      const anchorItem = byTaskId.get(mobility.anchorTaskId) ?? null;
      const anchorRange = anchorItem ? rangeByItemId.get(anchorItem.id) ?? null : null;
      const anchorProposal = anchorItem ? proposals.find((proposal) => proposal.item.id === anchorItem.id) ?? null : null;
      const gap = mobility.minimumGapMinutes ?? 0;
      if (anchorRange || anchorProposal) {
        const anchorStart = anchorRange?.startMinute ?? anchorProposal!.startMinute;
        const anchorEnd = anchorRange?.endMinute ?? anchorProposal!.endMinute;
        start = mobility.anchorRelation === "before" ? anchorStart - gap - duration : anchorEnd + gap;
        reason = mobility.anchorRelation === "before" ? "Stays immediately upstream of its recorded anchor." : "Follows its recorded anchor and gap.";
      }
    }

    if (start === null) {
      start = firstFit(itemWindow(item), duration, blocked);
      if (mobility.constraintClass === "windowed") reason = "Fits inside the recorded execution window.";
    }

    if (start === null) continue;
    proposals.push({ item, startMinute: start, endMinute: start + duration, durationMinutes: duration, reason });
  }

  return proposals.sort((left, right) => left.startMinute - right.startMinute || left.item.sequenceOrder - right.item.sequenceOrder);
}
