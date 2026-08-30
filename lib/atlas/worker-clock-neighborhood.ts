import type { AtlasClockReservation } from "@/lib/atlas/clock-reservations";
import type { AtlasClockTaskRange, AtlasCommittedClockItem } from "@/lib/atlas/clock-layout";

export type WorkerClockMoveRole = "last" | "now" | "next" | "then";
export type WorkerClockRailTask = { id: string; label: string; minute: number };
export type WorkerClockReservation = {
  id: string;
  label: string;
  kind: "point" | "span";
  startMinute: number;
  endMinute: number;
  timeLabel: string;
};
export type WorkerClockMove = {
  id: string;
  role: WorkerClockMoveRole;
  family: string;
  title: string;
  detail: string;
  timeLabel: string;
};
export type WorkerClockHardEdge = { id: string; label: string; timeLabel: string };
export type WorkerClockNeighborhood = {
  railTasks: WorkerClockRailTask[];
  reservations: WorkerClockReservation[];
  moves: WorkerClockMove[];
  hardEdge: WorkerClockHardEdge | null;
};

function finished(item: AtlasCommittedClockItem) {
  return item.status === "done" || item.status === "completed";
}

function open(item: AtlasCommittedClockItem) {
  return !finished(item);
}

export function workerClockMinuteLabel(minute: number) {
  const normalized = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minutePart = normalized % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minutePart).padStart(2, "0")} ${period}`;
}

export function workerClockRangeLabel(startMinute: number, endMinute: number) {
  if (endMinute <= startMinute) return workerClockMinuteLabel(startMinute);
  return `${workerClockMinuteLabel(startMinute)}–${workerClockMinuteLabel(endMinute)}`;
}

export function workerClockDateLabels(dateIso: string) {
  const parsed = new Date(`${dateIso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { weekdayLabel: "DAY", dateLabel: dateIso };
  return {
    weekdayLabel: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(parsed).toUpperCase(),
    dateLabel: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed),
  };
}

function family(item: AtlasCommittedClockItem) {
  return (item.workRoute || item.commitmentKind || "WORK").replaceAll("_", " ").toUpperCase();
}

function detail(item: AtlasCommittedClockItem) {
  return item.location || item.note || item.reason || `${item.dayWindow[0].toUpperCase()}${item.dayWindow.slice(1)} work`;
}

function moveFromRange(range: AtlasClockTaskRange, role: WorkerClockMoveRole, timeLabel?: string): WorkerClockMove {
  return {
    id: range.item.id,
    role,
    family: family(range.item),
    title: range.item.title,
    detail: detail(range.item),
    timeLabel: timeLabel ?? workerClockRangeLabel(range.startMinute, range.endMinute),
  };
}

function moveFromUntimed(item: AtlasCommittedClockItem, role: WorkerClockMoveRole): WorkerClockMove {
  return {
    id: item.id,
    role,
    family: family(item),
    title: item.title,
    detail: detail(item),
    timeLabel: "Today · timing unresolved",
  };
}

export function buildWorkerClockNeighborhood(input: {
  committed: AtlasCommittedClockItem[];
  ranges: AtlasClockTaskRange[];
  reservations: AtlasClockReservation[];
  nowMinute: number | null;
}): WorkerClockNeighborhood {
  const { committed, ranges, reservations, nowMinute } = input;
  const railTasks = ranges.map((range) => ({ id: range.item.id, label: range.item.title, minute: range.startMinute }));
  const surfaceReservations = reservations.map((reservation) => ({
    id: reservation.id,
    label: reservation.title,
    kind: reservation.kind,
    startMinute: reservation.startMinute,
    endMinute: reservation.endMinute,
    timeLabel: workerClockRangeLabel(reservation.startMinute, reservation.endMinute),
  }));

  const active = nowMinute === null ? null : ranges.find((range) => open(range.item)
    && Boolean(range.span.minutes)
    && range.startMinute <= nowMinute
    && range.endMinute > nowMinute) ?? null;

  const completedRanges = ranges
    .filter((range) => finished(range.item) && (nowMinute === null || range.endMinute <= nowMinute))
    .sort((left, right) => right.endMinute - left.endMinute || right.startMinute - left.startMinute);
  const last = completedRanges[0] ?? null;

  const excluded = new Set<string>();
  if (active) excluded.add(active.item.id);
  if (last) excluded.add(last.item.id);

  const futureRanges = ranges.filter((range) => open(range.item)
    && !excluded.has(range.item.id)
    && (nowMinute === null || range.startMinute >= nowMinute));
  for (const range of futureRanges) excluded.add(range.item.id);

  const untimed = committed
    .filter((item) => open(item) && !excluded.has(item.id) && !item.plannedStartAt)
    .sort((left, right) => left.sequenceOrder - right.sequenceOrder);

  const queue: Array<{ range?: AtlasClockTaskRange; item: AtlasCommittedClockItem }> = [
    ...futureRanges.map((range) => ({ range, item: range.item })),
    ...untimed.map((item) => ({ item })),
  ];

  const moves: WorkerClockMove[] = [];
  if (last) moves.push(moveFromRange(last, "last", `Done · ${workerClockMinuteLabel(last.endMinute)}`));
  if (active) moves.push(moveFromRange(active, "now"));
  const next = queue[0];
  const then = queue[1];
  if (next) moves.push(next.range ? moveFromRange(next.range, "next") : moveFromUntimed(next.item, "next"));
  if (then) moves.push(then.range ? moveFromRange(then.range, "then") : moveFromUntimed(then.item, "then"));

  const nextReservation = reservations.find((reservation) => nowMinute === null || reservation.startMinute > nowMinute) ?? null;
  const hardEdge = nextReservation ? {
    id: nextReservation.id,
    label: nextReservation.title,
    timeLabel: workerClockRangeLabel(nextReservation.startMinute, nextReservation.endMinute),
  } : null;

  return { railTasks, reservations: surfaceReservations, moves, hardEdge };
}
