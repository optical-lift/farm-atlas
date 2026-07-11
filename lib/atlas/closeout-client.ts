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

export type AtlasCloseoutRecord = {
  id: string;
  date: string;
  zone: string | null;
  spot: string | null;
  label: string;
  action: string | null;
  crop: string | null;
  variety: string | null;
  status: string | null;
  note: string | null;
  next: string | null;
  kind: string | null;
};

export type AtlasCloseoutSummary = {
  period: AtlasCloseoutPeriod;
  label: string;
  startDate: string;
  endDate: string;
  counts: AtlasCloseoutCounts;
  recent: string[];
  carryForward: string[];
  records: AtlasCloseoutRecord[];
};

export type AtlasCloseoutResponse = AtlasCloseoutSummary & {
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

  const data = (await response.json()) as Omit<AtlasCloseoutResponse, keyof AtlasCloseoutSummary>;
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Failed to load closeout.");

  const summary = data.summaries.find((item) => item.period === "day") ?? data.summaries[0];
  if (!summary) throw new Error("Closeout response did not include a summary.");
  return { ...data, ...summary };
}

export async function saveAtlasCloseout(payload: {
  period: AtlasCloseoutPeriod;
  note: string;
  carryForward?: string;
  nextFocus?: string;
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
