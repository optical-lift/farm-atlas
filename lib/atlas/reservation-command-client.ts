import type { AtlasDayReservationKind } from "@/lib/atlas/day-reservations";

export type AtlasReservationCreateCommand = {
  kind: "reservation_create";
  serviceDate: string;
  reservationId: string;
  reservationKind: AtlasDayReservationKind;
  title: string;
  startLocalTime: string;
  endLocalTime: string;
  note?: string | null;
  metadata?: Record<string, unknown>;
};

export type AtlasReservationChangeCommand = {
  kind: "reservation_change";
  serviceDate: string;
  reservationId: string;
  reservationKind?: AtlasDayReservationKind;
  title?: string;
  startLocalTime?: string;
  endLocalTime?: string;
  note?: string | null;
};

export type AtlasReservationMoveCommand = {
  kind: "reservation_move";
  serviceDate: string;
  reservationId: string;
  startLocalTime: string;
};

export type AtlasReservationResizeCommand = {
  kind: "reservation_resize";
  serviceDate: string;
  reservationId: string;
  endLocalTime: string;
};

export type AtlasReservationRemoveCommand = {
  kind: "reservation_remove";
  serviceDate: string;
  reservationId: string;
};

export type AtlasReservationCommand =
  | AtlasReservationCreateCommand
  | AtlasReservationChangeCommand
  | AtlasReservationMoveCommand
  | AtlasReservationResizeCommand
  | AtlasReservationRemoveCommand;

export type AtlasReservationCommandResponse = {
  ok: true;
  date: string;
  reservationId: string;
  result?: unknown;
};

function operation(command: AtlasReservationCommand) {
  if (command.kind === "reservation_create") return "create";
  if (command.kind === "reservation_change") return "change";
  if (command.kind === "reservation_move") return "move";
  if (command.kind === "reservation_resize") return "resize";
  return "remove";
}

function commandError(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

/** Canonical reservation mutation transport. AtlasRuntime owns optimistic overlays and reconciliation. */
export async function commitAtlasReservationCommand(command: AtlasReservationCommand): Promise<AtlasReservationCommandResponse> {
  const body: Record<string, unknown> = {
    date: command.serviceDate,
    operation: operation(command),
    reservationId: command.reservationId,
  };
  if (command.kind === "reservation_create") {
    Object.assign(body, {
      reservationKind: command.reservationKind,
      title: command.title,
      startLocalTime: command.startLocalTime,
      endLocalTime: command.endLocalTime,
      note: command.note ?? null,
      metadata: command.metadata ?? {},
    });
  } else if (command.kind === "reservation_change") {
    if (command.reservationKind !== undefined) body.reservationKind = command.reservationKind;
    if (command.title !== undefined) body.title = command.title;
    if (command.startLocalTime !== undefined) body.startLocalTime = command.startLocalTime;
    if (command.endLocalTime !== undefined) body.endLocalTime = command.endLocalTime;
    if (command.note !== undefined) body.note = command.note;
  } else if (command.kind === "reservation_move") {
    body.startLocalTime = command.startLocalTime;
  } else if (command.kind === "reservation_resize") {
    body.endLocalTime = command.endLocalTime;
  }

  const response = await fetch("/api/atlas/owner-day-reservation", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-atlas-intent": "owner-day-reservation-v1",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json() as AtlasReservationCommandResponse | { ok?: false; error?: string };
  if (!response.ok || result.ok !== true) throw new Error(commandError(result, "Atlas could not update this reservation."));
  return result;
}
