import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";

export type AtlasCommittedClockItem = Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;

export type AtlasClockSpan = {
  minutes: number | null;
  source: "planned" | "estimate" | "none";
};

export type AtlasClockTaskRange = {
  item: AtlasCommittedClockItem;
  startMinute: number;
  endMinute: number;
  span: AtlasClockSpan;
};

export type AtlasClockTaskLayout = AtlasClockTaskRange & {
  laneIndex: number;
  laneCount: number;
  conflict: boolean;
};

export function clockLocalMinuteOfDay(value: string | null, timeZone = "America/Chicago") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

export function clockSpanForTask(item: AtlasCommittedClockItem, allowPrivateEstimate = false): AtlasClockSpan {
  if (item.plannedDurationMinutes && item.plannedDurationMinutes > 0) {
    return { minutes: item.plannedDurationMinutes, source: "planned" };
  }
  if (allowPrivateEstimate && item.estimatedMinutes && item.estimatedMinutes > 0) {
    return { minutes: item.estimatedMinutes, source: "estimate" };
  }
  return { minutes: null, source: "none" };
}

export function buildClockTaskRanges(
  items: AtlasCommittedClockItem[],
  options: { allowPrivateEstimate?: boolean; timeZone?: string } = {},
) {
  const allowPrivateEstimate = options.allowPrivateEstimate === true;
  const timeZone = options.timeZone ?? "America/Chicago";
  return items
    .filter((item) => Boolean(item.plannedStartAt))
    .map((item) => {
      const startMinute = clockLocalMinuteOfDay(item.plannedStartAt, timeZone);
      if (startMinute === null) return null;
      const span = clockSpanForTask(item, allowPrivateEstimate);
      return {
        item,
        startMinute,
        endMinute: startMinute + (span.minutes ?? 0),
        span,
      } satisfies AtlasClockTaskRange;
    })
    .filter((range): range is AtlasClockTaskRange => Boolean(range))
    .sort((left, right) => left.startMinute - right.startMinute || left.item.sequenceOrder - right.item.sequenceOrder);
}

export function clockConflictTaskIds(ranges: AtlasClockTaskRange[]) {
  const conflicts = new Set<string>();
  for (let leftIndex = 0; leftIndex < ranges.length; leftIndex += 1) {
    const left = ranges[leftIndex];
    if (!left.span.minutes) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < ranges.length; rightIndex += 1) {
      const right = ranges[rightIndex];
      if (right.startMinute >= left.endMinute) break;
      if (!right.span.minutes) continue;
      if (right.startMinute < left.endMinute && right.endMinute > left.startMinute) {
        conflicts.add(left.item.id);
        conflicts.add(right.item.id);
      }
    }
  }
  return conflicts;
}

export function layoutClockTaskRanges(ranges: AtlasClockTaskRange[]): AtlasClockTaskLayout[] {
  const result: AtlasClockTaskLayout[] = [];
  let index = 0;

  while (index < ranges.length) {
    const first = ranges[index];
    if (!first.span.minutes) {
      result.push({ ...first, laneIndex: 0, laneCount: 1, conflict: false });
      index += 1;
      continue;
    }

    const cluster: AtlasClockTaskRange[] = [first];
    let clusterEnd = first.endMinute;
    let cursor = index + 1;
    while (cursor < ranges.length) {
      const candidate = ranges[cursor];
      if (!candidate.span.minutes || candidate.startMinute >= clusterEnd) break;
      cluster.push(candidate);
      clusterEnd = Math.max(clusterEnd, candidate.endMinute);
      cursor += 1;
    }

    if (cluster.length === 1) {
      result.push({ ...first, laneIndex: 0, laneCount: 1, conflict: false });
      index += 1;
      continue;
    }

    const laneEnds: number[] = [];
    const assigned = cluster.map((range) => {
      let laneIndex = laneEnds.findIndex((endMinute) => endMinute <= range.startMinute);
      if (laneIndex < 0) laneIndex = laneEnds.length;
      laneEnds[laneIndex] = range.endMinute;
      return { range, laneIndex };
    });
    const laneCount = Math.max(1, laneEnds.length);
    for (const entry of assigned) {
      result.push({ ...entry.range, laneIndex: entry.laneIndex, laneCount, conflict: laneCount > 1 });
    }
    index = cursor;
  }

  return result.sort((left, right) => left.startMinute - right.startMinute || left.item.sequenceOrder - right.item.sequenceOrder);
}

function unfinished(item: AtlasCommittedClockItem) {
  return item.status !== "done" && item.status !== "completed";
}

export function chooseClockNextTask(
  committed: AtlasCommittedClockItem[],
  ranges: AtlasClockTaskRange[],
  nowMinute: number | null,
) {
  const openCommitted = committed.filter(unfinished);
  if (!openCommitted.length) return null;

  if (nowMinute !== null) {
    const active = ranges.find((range) => unfinished(range.item)
      && Boolean(range.span.minutes)
      && range.startMinute <= nowMinute
      && range.endMinute > nowMinute);
    if (active) return active.item;

    const future = ranges.find((range) => unfinished(range.item) && range.startMinute >= nowMinute);
    if (future) return future.item;
  } else {
    const firstTimed = ranges.find((range) => unfinished(range.item));
    if (firstTimed) return firstTimed.item;
  }

  return openCommitted.find((item) => !item.plannedStartAt) ?? openCommitted[0] ?? null;
}
