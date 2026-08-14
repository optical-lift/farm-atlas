import { clockLocalMinuteOfDay } from "@/lib/atlas/clock-layout";
import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";

export type AtlasClockReservationSource = "timed_cue" | "routine" | "external_commitment";
export type AtlasClockReservationKind = "point" | "span";

export type AtlasClockReservation = {
  id: string;
  title: string;
  source: AtlasClockReservationSource;
  kind: AtlasClockReservationKind;
  startMinute: number;
  endMinute: number;
  blocking: true;
  reason: string;
};

export type AtlasClockExternalReservationInput = {
  id: string;
  title: string;
  source: Exclude<AtlasClockReservationSource, "timed_cue">;
  startAt: string;
  endAt?: string | null;
  reason?: string | null;
};

type TimedCue = Extract<AtlasDaySequenceItem, { kind: "cue" }>;

const hiddenCueStatuses = new Set(["resolved", "dismissed", "stale"]);

function validTimedCue(cue: TimedCue) {
  return cue.anchorKind === "at_time"
    && cue.positionResolved
    && Boolean(cue.scheduledAt)
    && !hiddenCueStatuses.has(cue.status);
}

export function atlasClockReservationConflicts(
  startMinute: number,
  endMinute: number,
  reservation: AtlasClockReservation,
) {
  if (reservation.kind === "point") {
    return startMinute < reservation.startMinute && endMinute > reservation.startMinute;
  }
  return startMinute < reservation.endMinute && endMinute > reservation.startMinute;
}

export function buildAtlasClockReservations(input: {
  timedCues?: TimedCue[];
  commitments?: AtlasClockExternalReservationInput[];
  timeZone?: string;
} = {}) {
  const timeZone = input.timeZone ?? "America/Chicago";
  const reservations: AtlasClockReservation[] = [];

  for (const cue of input.timedCues ?? []) {
    if (!validTimedCue(cue)) continue;
    const minute = clockLocalMinuteOfDay(cue.scheduledAt, timeZone);
    if (minute === null) continue;
    reservations.push({
      id: `timed-cue:${cue.cueId}`,
      title: cue.title,
      source: "timed_cue",
      kind: "point",
      startMinute: minute,
      endMinute: minute,
      blocking: true,
      reason: "A real timed cue interrupts this point in the Elm Farm day.",
    });
  }

  for (const commitment of input.commitments ?? []) {
    const startMinute = clockLocalMinuteOfDay(commitment.startAt, timeZone);
    if (startMinute === null) continue;
    const resolvedEnd = clockLocalMinuteOfDay(commitment.endAt ?? null, timeZone);
    const kind: AtlasClockReservationKind = resolvedEnd !== null && resolvedEnd > startMinute ? "span" : "point";
    reservations.push({
      id: `${commitment.source}:${commitment.id}`,
      title: commitment.title,
      source: commitment.source,
      kind,
      startMinute,
      endMinute: kind === "span" ? resolvedEnd as number : startMinute,
      blocking: true,
      reason: commitment.reason?.trim() || "A real non-task commitment reserves this part of the day.",
    });
  }

  return reservations.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute || left.id.localeCompare(right.id));
}
