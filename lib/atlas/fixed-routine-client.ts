import type { AtlasDayReservationKind } from "@/lib/atlas/day-reservations";

export type AtlasFixedRoutine = {
  routineId: string;
  kind: AtlasDayReservationKind;
  title: string;
  startLocalTime: string;
  durationMinutes: number;
  weekdays: number[];
  effectiveFrom: string;
  effectiveThrough: string | null;
  active: boolean;
  note: string | null;
};

export type AtlasFixedRoutineCreateCommand = {
  kind: "fixed_routine_create";
  routineId: string;
  reservationKind: AtlasDayReservationKind;
  title: string;
  startLocalTime: string;
  endLocalTime: string;
  weekdays: number[];
  effectiveFrom: string;
  effectiveThrough?: string | null;
  note?: string | null;
};

export type AtlasFixedRoutineChangeCommand = {
  kind: "fixed_routine_change";
  routineId: string;
  reservationKind?: AtlasDayReservationKind;
  title?: string;
  startLocalTime?: string;
  endLocalTime?: string;
  weekdays?: number[];
  effectiveFrom?: string;
  effectiveThrough?: string | null;
  note?: string | null;
};

export type AtlasFixedRoutineEndCommand = {
  kind: "fixed_routine_end";
  routineId: string;
  effectiveThrough: string;
};

export type AtlasFixedRoutineResumeCommand = {
  kind: "fixed_routine_resume";
  routineId: string;
};

export type AtlasFixedRoutineCommand =
  | AtlasFixedRoutineCreateCommand
  | AtlasFixedRoutineChangeCommand
  | AtlasFixedRoutineEndCommand
  | AtlasFixedRoutineResumeCommand;

export type AtlasFixedRoutineCommandResponse = {
  ok: true;
  routineId: string;
  result?: unknown;
};

export type AtlasFixedRoutineReadResponse = {
  ok: true;
  workerLabel: string;
  routines: AtlasFixedRoutine[];
};

function commandOperation(command: AtlasFixedRoutineCommand) {
  if (command.kind === "fixed_routine_create") return "create";
  if (command.kind === "fixed_routine_change") return "change";
  if (command.kind === "fixed_routine_end") return "end";
  return "resume";
}

function responseError(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

export async function readAtlasFixedRoutines(): Promise<AtlasFixedRoutineReadResponse> {
  const response = await fetch("/api/atlas/owner-fixed-routine", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const result = await response.json() as AtlasFixedRoutineReadResponse | { ok?: false; error?: string };
  if (!response.ok || result.ok !== true) throw new Error(responseError(result, "Atlas could not load repeating fixed times."));
  return result;
}

/** Canonical fixed-routine source mutation transport. Worker Day reservations remain the dated occupancy truth. */
export async function commitAtlasFixedRoutineCommand(command: AtlasFixedRoutineCommand): Promise<AtlasFixedRoutineCommandResponse> {
  const body: Record<string, unknown> = {
    operation: commandOperation(command),
    routineId: command.routineId,
  };
  if (command.kind === "fixed_routine_create") {
    Object.assign(body, {
      reservationKind: command.reservationKind,
      title: command.title,
      startLocalTime: command.startLocalTime,
      endLocalTime: command.endLocalTime,
      weekdays: command.weekdays,
      effectiveFrom: command.effectiveFrom,
      effectiveThrough: command.effectiveThrough ?? null,
      note: command.note ?? null,
    });
  } else if (command.kind === "fixed_routine_change") {
    if (command.reservationKind !== undefined) body.reservationKind = command.reservationKind;
    if (command.title !== undefined) body.title = command.title;
    if (command.startLocalTime !== undefined) body.startLocalTime = command.startLocalTime;
    if (command.endLocalTime !== undefined) body.endLocalTime = command.endLocalTime;
    if (command.weekdays !== undefined) body.weekdays = command.weekdays;
    if (command.effectiveFrom !== undefined) body.effectiveFrom = command.effectiveFrom;
    if (command.effectiveThrough !== undefined) body.effectiveThrough = command.effectiveThrough;
    if (command.note !== undefined) body.note = command.note;
  } else if (command.kind === "fixed_routine_end") {
    body.effectiveThrough = command.effectiveThrough;
  }

  const response = await fetch("/api/atlas/owner-fixed-routine", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-atlas-intent": "owner-fixed-routine-v1",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json() as AtlasFixedRoutineCommandResponse | { ok?: false; error?: string };
  if (!response.ok || result.ok !== true) throw new Error(responseError(result, "Atlas could not update this repeating fixed time."));
  return result;
}
