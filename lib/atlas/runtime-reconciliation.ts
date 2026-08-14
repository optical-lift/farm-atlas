import type { AtlasClockCommand } from "@/lib/atlas/clock-command-client";
import type { AtlasDayReservation } from "@/lib/atlas/day-reservations";
import type { AtlasReservationCommand } from "@/lib/atlas/reservation-command-client";
import type { AtlasWorkerDayProjectionRead } from "@/lib/atlas/worker-day-projection-client";
import type { AtlasTaskTransition } from "@/lib/atlas/task-transition-client";

export type AtlasRuntimePendingTaskTransition = {
  actionId: string;
  kind: "task_transition";
  serviceDate: string;
  taskId: string;
  transition: AtlasTaskTransition;
  phase: "committing" | "reconciling";
};

export type AtlasRuntimePendingClockCommand = {
  actionId: string;
  kind: "clock_command";
  serviceDate: string;
  command: AtlasClockCommand;
  phase: "committing" | "reconciling";
};

export type AtlasRuntimePendingReservationCommand = {
  actionId: string;
  kind: "reservation_command";
  serviceDate: string;
  command: AtlasReservationCommand;
  phase: "committing" | "reconciling";
};

export type AtlasRuntimePendingAction =
  | AtlasRuntimePendingTaskTransition
  | AtlasRuntimePendingClockCommand
  | AtlasRuntimePendingReservationCommand;

function optimisticTaskStatus(transition: AtlasTaskTransition) {
  if (transition === "done") return "done";
  if (transition === "reopened") return "open";
  return null;
}

function localClockInstant(dateIso: string, localTime: string | null, timeZone = "America/Chicago") {
  if (!localTime) return null;
  const match = `${dateIso}T${localTime}`.match(/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const target = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]),
  };
  let instant = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const rendered = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute),
    );
    const wanted = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
    instant += wanted - rendered;
  }
  return new Date(instant).toISOString();
}

function clockOverlayByTask(pendingActions: AtlasRuntimePendingAction[]) {
  const overlays = new Map<string, { setStart?: boolean; plannedStartAt?: string | null; setDuration?: boolean; plannedDurationMinutes?: number | null }>();
  for (const action of pendingActions) {
    if (action.kind !== "clock_command") continue;
    const command = action.command;
    if (command.kind === "clock_time") {
      overlays.set(command.taskId, {
        ...(overlays.get(command.taskId) ?? {}),
        setStart: true,
        plannedStartAt: localClockInstant(command.serviceDate, command.localTime),
      });
      continue;
    }
    if (command.kind === "clock_duration") {
      overlays.set(command.taskId, {
        ...(overlays.get(command.taskId) ?? {}),
        setDuration: true,
        plannedDurationMinutes: command.durationMinutes,
      });
      continue;
    }
    for (const change of command.changes) {
      overlays.set(change.taskId, {
        ...(overlays.get(change.taskId) ?? {}),
        ...(change.setStart ? {
          setStart: true,
          plannedStartAt: localClockInstant(command.serviceDate, change.startLocalTime),
        } : {}),
        ...(change.setDuration ? {
          setDuration: true,
          plannedDurationMinutes: change.durationMinutes,
        } : {}),
      });
    }
  }
  return overlays;
}

function reservationOverlay(canonical: AtlasDayReservation[], pendingActions: AtlasRuntimePendingAction[]) {
  let reservations = canonical.map((reservation) => ({ ...reservation }));
  for (const action of pendingActions) {
    if (action.kind !== "reservation_command") continue;
    const command = action.command;
    const index = reservations.findIndex((reservation) => reservation.reservationId === command.reservationId);

    if (command.kind === "reservation_create") {
      const startAt = localClockInstant(command.serviceDate, command.startLocalTime);
      const endAt = localClockInstant(command.serviceDate, command.endLocalTime);
      if (!startAt || !endAt) continue;
      const optimistic: AtlasDayReservation = {
        reservationId: command.reservationId,
        serviceDate: command.serviceDate,
        kind: command.reservationKind,
        title: command.title,
        startAt,
        endAt,
        source: "owner_manual",
        sourceReference: null,
        note: command.note?.trim() || null,
      };
      if (index >= 0) reservations[index] = optimistic;
      else reservations.push(optimistic);
      continue;
    }

    if (index < 0) continue;
    const current = reservations[index];
    if (command.kind === "reservation_remove") {
      reservations = reservations.filter((reservation) => reservation.reservationId !== command.reservationId);
      continue;
    }
    if (command.kind === "reservation_move") {
      const startAt = localClockInstant(command.serviceDate, command.startLocalTime);
      if (!startAt) continue;
      const duration = new Date(current.endAt).getTime() - new Date(current.startAt).getTime();
      reservations[index] = {
        ...current,
        startAt,
        endAt: new Date(new Date(startAt).getTime() + Math.max(0, duration)).toISOString(),
      };
      continue;
    }
    if (command.kind === "reservation_resize") {
      const endAt = localClockInstant(command.serviceDate, command.endLocalTime);
      if (!endAt) continue;
      reservations[index] = { ...current, endAt };
      continue;
    }

    reservations[index] = {
      ...current,
      ...(command.reservationKind ? { kind: command.reservationKind } : {}),
      ...(command.title !== undefined ? { title: command.title } : {}),
      ...(command.note !== undefined ? { note: command.note?.trim() || null } : {}),
      ...(command.startLocalTime !== undefined ? { startAt: localClockInstant(command.serviceDate, command.startLocalTime) ?? current.startAt } : {}),
      ...(command.endLocalTime !== undefined ? { endAt: localClockInstant(command.serviceDate, command.endLocalTime) ?? current.endAt } : {}),
    };
  }
  return reservations.sort((left, right) => left.startAt.localeCompare(right.startAt) || left.reservationId.localeCompare(right.reservationId));
}

export function applyAtlasRuntimePendingActions(
  canonical: AtlasWorkerDayProjectionRead | null,
  pendingActions: AtlasRuntimePendingAction[],
): AtlasWorkerDayProjectionRead | null {
  if (!canonical || !pendingActions.length) return canonical;

  const statusByTaskId = new Map<string, string>();
  for (const action of pendingActions) {
    if (action.kind !== "task_transition") continue;
    const status = optimisticTaskStatus(action.transition);
    if (status) statusByTaskId.set(action.taskId, status);
  }
  const clockByTaskId = clockOverlayByTask(pendingActions);
  const reservations = reservationOverlay(canonical.projection.reservations, pendingActions);
  const reservationsChanged = pendingActions.some((action) => action.kind === "reservation_command");
  if (!statusByTaskId.size && !clockByTaskId.size && !reservationsChanged) return canonical;

  const sequence = canonical.projection.sequence;
  const items = sequence.items.map((item) => {
    if ((item.kind !== "committed_task" && item.kind !== "potential_task") || !item.taskId) return item;
    const status = statusByTaskId.get(item.taskId);
    const clock = clockByTaskId.get(item.taskId);
    if (!status && !clock) return item;
    return {
      ...item,
      ...(status ? { status } : {}),
      ...(clock?.setStart ? { plannedStartAt: clock.plannedStartAt ?? null } : {}),
      ...(clock?.setDuration ? { plannedDurationMinutes: clock.plannedDurationMinutes ?? null } : {}),
    };
  });
  const taskCards = canonical.taskCards.map((task) => {
    const status = statusByTaskId.get(task.task_id);
    if (!status) return task;
    return {
      ...task,
      status,
      metadata: {
        ...(task.metadata ?? {}),
        checklist_status: status === "done" ? "done" : "open",
      },
    };
  });

  return {
    ...canonical,
    taskCards,
    projection: {
      ...canonical.projection,
      // Pending actions derive display state only. The canonical revision belongs to the server projection and is never fabricated here.
      sequence: { ...sequence, items },
      reservations,
    },
  };
}
