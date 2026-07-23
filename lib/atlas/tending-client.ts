export type TendingSectionKey = "harvest_now" | "unlock_next" | "protect_harvests" | "needs_a_look";
export type TendingGateStatus = "complete" | "current" | "future" | "blocked" | "skipped";

export type TendingGate = {
  key: string;
  label: string;
  status: TendingGateStatus;
  taskId?: string | null;
  dueDate?: string | null;
};

export type TendingBedTrack = {
  bedKey: string;
  bedLabel: string;
  zoneKey: string;
  zoneLabel: string;
  objectType?: string | null;
  objectMode?: string | null;
  cropCycleId?: string | null;
  cropLabel: string;
  cropStage?: string | null;
  cropLifecycleStatus?: string | null;
  harvestMetricType: "harvest" | "harvest_rounds" | "harvest_opportunities" | string;
  harvestCeiling?: number | null;
  harvestForecast?: number | null;
  actualHarvestCount?: number | null;
  actualMarketableStems?: number | null;
  firstOrNextHarvestOn?: string | null;
  harvestWindowEndsOn?: string | null;
  clockBasis?: "forecast" | "confirmed" | string;
  sownOn?: string | null;
  plantedOn?: string | null;
  currentGate?: TendingGate | null;
  gates: TendingGate[];
  remainingGateCount: number;
  stepsToHarvestCount?: number | null;
  totalStepCount?: number | null;
  currentStepNumber?: number | null;
  releasedTaskId?: string | null;
  taskTitle?: string | null;
  taskDueDate?: string | null;
  taskEffortMinutes?: number | null;
  unlockLabel: string;
  forecastLoss?: number | null;
  nextLossOn?: string | null;
  requiresObservation: boolean;
  isActionableNow: boolean;
  sectionKey: TendingSectionKey;
  miniGame?: null;
};

export type TendingBoard = {
  generatedAt: string;
  miniGamesEnabled: false;
  actionableCount: number;
  bedCount: number;
  nextHarvestOn?: string | null;
  cards: TendingBedTrack[];
};

export type TendingBoardResponse = {
  ok: boolean;
  farmKey?: string;
  role?: string;
  tending?: TendingBoard;
  error?: string;
};

export type TendingBedResponse = {
  ok: boolean;
  farmKey?: string;
  role?: string;
  miniGamesEnabled?: false;
  bed?: TendingBedTrack;
  error?: string;
};

function errorText(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
  return fallback;
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = (await response.json()) as T & { ok?: boolean; error?: unknown };
  if (!response.ok || data.ok === false) throw new Error(errorText(data.error, fallback));
  return data;
}

export async function fetchTendingBoard(): Promise<TendingBoardResponse> {
  const response = await fetch("/api/atlas/tending", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  return readJson<TendingBoardResponse>(response, "Tending failed to load.");
}

export async function fetchTendingBed(objectKey: string): Promise<TendingBedResponse> {
  const response = await fetch(`/api/atlas/tending/bed?objectKey=${encodeURIComponent(objectKey)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  return readJson<TendingBedResponse>(response, "This bed track failed to load.");
}

export async function fetchTendingTaskContext(taskId: string, objectKey: string): Promise<TendingBedResponse> {
  const params = new URLSearchParams({ taskId, objectKey });
  const response = await fetch(`/api/atlas/tending/task-context?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  return readJson<TendingBedResponse>(response, "Tending context failed to load.");
}

export function prettyTendingDate(dateIso: string | null | undefined, includeYear = false) {
  if (!dateIso) return "Not dated";
  const date = new Date(`${dateIso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(includeYear ? { year: "numeric" } : {}) });
}

export function tendingDaysUntil(dateIso: string | null | undefined) {
  if (!dateIso) return null;
  const target = new Date(`${dateIso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

export function tendingDueLabel(dateIso: string | null | undefined) {
  if (!dateIso) return "Date not set";
  const days = tendingDaysUntil(dateIso);
  const date = prettyTendingDate(dateIso);
  if (days === 0) return `Today · ${date}`;
  if (days === 1) return `Tomorrow · ${date}`;
  return `Due ${date}`;
}

export function tendingStepLabel(track: Pick<TendingBedTrack, "currentStepNumber" | "totalStepCount">) {
  if (!track.currentStepNumber || !track.totalStepCount) return "Next step";
  return `Step ${track.currentStepNumber} of ${track.totalStepCount}`;
}

export function tendingStepsToHarvestLabel(track: Pick<TendingBedTrack, "stepsToHarvestCount" | "remainingGateCount">) {
  const count = track.stepsToHarvestCount ?? Math.max(0, track.remainingGateCount - 1);
  return `${count} ${count === 1 ? "step" : "steps"} to harvest`;
}

export function tendingClock(track: Pick<TendingBedTrack, "firstOrNextHarvestOn" | "clockBasis">) {
  if (!track.firstOrNextHarvestOn) return "Harvest date not set";
  const days = tendingDaysUntil(track.firstOrNextHarvestOn);
  const date = prettyTendingDate(track.firstOrNextHarvestOn);
  if (days === null) return date;
  if (days < 0) return `Harvest window opened ${Math.abs(days)}d ago`;
  if (days === 0) return "Harvest window opens today";
  return track.clockBasis === "confirmed" ? `${days} days to harvest · ${date}` : `Harvest forecast ${date} · ${days} days`;
}

export function formatTendingEffort(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return "Effort not set";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function tendingTaskHref(track: TendingBedTrack) {
  if (!track.releasedTaskId) return null;
  const boardPath = `/collections/weeding/${encodeURIComponent(track.zoneKey)}/${encodeURIComponent(track.bedKey)}`;
  const params = new URLSearchParams({
    taskId: track.releasedTaskId,
    from: "tending",
    bedKey: track.bedKey,
    returnTo: boardPath,
  });
  return `/task?${params.toString()}`;
}

export function tendingBedHref(track: Pick<TendingBedTrack, "zoneKey" | "bedKey">) {
  return `/collections/weeding/${encodeURIComponent(track.zoneKey)}/${encodeURIComponent(track.bedKey)}`;
}
