import type { AtlasClockDraftCommitChange } from "@/lib/atlas/clock-plan-draft";

export type AtlasClockTimeCommand = {
  kind: "clock_time";
  serviceDate: string;
  taskId: string;
  localTime: string | null;
};

export type AtlasClockDurationCommand = {
  kind: "clock_duration";
  serviceDate: string;
  taskId: string;
  durationMinutes: number | null;
};

export type AtlasClockPlanCommitCommand = {
  kind: "clock_plan_commit";
  serviceDate: string;
  changes: AtlasClockDraftCommitChange[];
};

export type AtlasClockCommand =
  | AtlasClockTimeCommand
  | AtlasClockDurationCommand
  | AtlasClockPlanCommitCommand;

export type AtlasClockCommandResponse = {
  ok: true;
  date?: string;
  taskId?: string;
  placement?: unknown;
  result?: unknown;
};

function commandError(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

async function postClockCommand(
  path: string,
  intent: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<AtlasClockCommandResponse> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-atlas-intent": intent,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json() as AtlasClockCommandResponse | { ok?: false; error?: string };
  if (!response.ok || result.ok !== true) throw new Error(commandError(result, fallback));
  return result;
}

/**
 * Canonical Clock mutation transport only. AtlasRuntime owns optimistic projection
 * overlays, rollback, and authoritative reconciliation around this primitive.
 */
export function commitAtlasClockCommand(command: AtlasClockCommand) {
  if (command.kind === "clock_time") {
    return postClockCommand(
      "/api/atlas/owner-day-task-time",
      "owner-clock-time-v1",
      { date: command.serviceDate, taskId: command.taskId, localTime: command.localTime },
      "Atlas could not update this Clock placement.",
    );
  }
  if (command.kind === "clock_duration") {
    return postClockCommand(
      "/api/atlas/owner-day-task-duration",
      "owner-clock-duration-v1",
      { date: command.serviceDate, taskId: command.taskId, durationMinutes: command.durationMinutes },
      "Atlas could not update this Clock duration.",
    );
  }
  return postClockCommand(
    "/api/atlas/owner-clock-plan-commit",
    "owner-clock-plan-commit-v1",
    { date: command.serviceDate, changes: command.changes },
    "Atlas could not commit this Clock plan.",
  );
}
