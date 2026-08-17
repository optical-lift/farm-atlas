export type AtlasWorkerDayShapeCommand = { serviceDate: string; weekdays: number[]; localStart: string; localEnd: string };
export type AtlasWorkerDayShapeCommandResponse = { ok: true; date: string; result?: unknown };

function errorMessage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Atlas could not update the Worker Day shape.";
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error : "Atlas could not update the Worker Day shape.";
}

export async function commitAtlasWorkerDayShape(command: AtlasWorkerDayShapeCommand) {
  const response = await fetch("/api/atlas/owner-worker-day-shape", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json", "Content-Type": "application/json", "x-atlas-intent": "owner-worker-day-shape-v1" }, body: JSON.stringify({ date: command.serviceDate, weekdays: command.weekdays, localStart: command.localStart, localEnd: command.localEnd }) });
  const result = await response.json() as AtlasWorkerDayShapeCommandResponse | { ok?: false; error?: string };
  if (!response.ok || result.ok !== true) throw new Error(errorMessage(result));
  return result;
}
