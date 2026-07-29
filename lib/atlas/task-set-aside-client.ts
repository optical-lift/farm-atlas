import type {
  AtlasTaskDayDisposition,
  AtlasTaskSetAsideResult,
} from "@/lib/atlas/task-set-aside-contract";

type AtlasApiError = string | { message?: string };

type SetAsideResponse = AtlasTaskSetAsideResult & {
  ok?: boolean;
  error?: AtlasApiError;
  details?: string;
};

type DayDispositionResponse = {
  ok?: boolean;
  dispositions?: AtlasTaskDayDisposition[];
  error?: AtlasApiError;
  details?: string;
};

export function centralDateIso() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function errorMessage(data: { error?: AtlasApiError; details?: string }, fallback: string) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  if (data.error?.message) return data.error.message;
  return fallback;
}

export async function postAtlasTaskSetAsideToday(
  taskId: string,
  requestedReturnDate = addDaysIso(centralDateIso(), 1),
): Promise<AtlasTaskSetAsideResult> {
  const serviceDate = centralDateIso();
  const response = await fetch("/api/atlas/task-set-aside", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "task-set-aside-v2",
    },
    cache: "no-store",
    body: JSON.stringify({
      taskId,
      requestedReturnDate,
      idempotencyKey: `task-set-aside-v2:${taskId}:${serviceDate}:${requestedReturnDate}`,
    }),
  });
  const data = await response.json() as SetAsideResponse;
  if (!response.ok || !data.ok) throw new Error(errorMessage(data, "Atlas could not set this task aside."));
  return data;
}

export async function fetchAtlasTaskDayDispositions(day: string): Promise<AtlasTaskDayDisposition[]> {
  const response = await fetch(`/api/atlas/task-set-aside?day=${encodeURIComponent(day)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await response.json() as DayDispositionResponse;
  if (!response.ok || !data.ok) throw new Error(errorMessage(data, "Atlas could not read today’s set-aside work."));
  return Array.isArray(data.dispositions) ? data.dispositions : [];
}
