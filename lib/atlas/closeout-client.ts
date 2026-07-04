export type AtlasCloseoutPeriod = "day" | "week" | "month";

export type AtlasCloseoutCounts = {
  logs: number;
  objectEvents: number;
  tasksDone: number;
  tasksBlocked: number;
  openTasks: number;
  followUps: number;
  seeded: number;
  germination: number;
  weeded: number;
  harvested: number;
  changed: number;
  closeouts: number;
};

export type AtlasCloseoutSummary = {
  period: AtlasCloseoutPeriod;
  label: string;
  startDate: string;
  endDate: string;
  counts: AtlasCloseoutCounts;
  recent: string[];
  carryForward: string[];
};

export type AtlasCloseoutResponse = {
  ok: boolean;
  today: string;
  summaries: AtlasCloseoutSummary[];
  error?: string;
  details?: string;
};

export type AtlasCloseoutSaveResponse = {
  ok: boolean;
  fieldLogId?: string;
  error?: string;
  details?: string;
};

export async function fetchAtlasCloseout(): Promise<AtlasCloseoutResponse> {
  const response = await fetch("/api/atlas/closeout", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const data = (await response.json()) as AtlasCloseoutResponse;
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Failed to load closeout.");
  return data;
}

export async function saveAtlasCloseout(payload: {
  period: AtlasCloseoutPeriod;
  note: string;
  carryForward?: string;
  nextFocus?: string;
  createdBy?: string;
}): Promise<AtlasCloseoutSaveResponse> {
  const response = await fetch("/api/atlas/closeout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as AtlasCloseoutSaveResponse;
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Failed to save closeout.");
  return data;
}
