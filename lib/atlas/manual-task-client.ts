export type AtlasManualTaskActionKind =
  | "check"
  | "water"
  | "sow"
  | "transplant"
  | "harvest"
  | "repair"
  | "reset"
  | "prepare"
  | "deliver"
  | "other";

export type AtlasManualTaskDateCommitment = "hard_date" | "floating";
export type AtlasManualTaskEffort = "light" | "standard" | "heavy";

export type AtlasManualTaskMembership = {
  membershipId: string;
  userId: string;
  role: string;
  workerKey: string | null;
  displayName: string;
  activeTaskCount: number;
};

export type AtlasManualTaskDayLoad = {
  membershipId: string;
  workDate: string;
  role: string;
  lightCount: number;
  standardCount: number;
  heavyCount: number;
  activeUnits: number;
  reservoirUnits: number;
  totalUnits: number;
  requiredUnits: number;
  discretionaryUnits: number;
  dailyUnitBudget: number;
  budgetEnforced: boolean;
  overloaded: boolean;
  remainingDiscretionaryUnits: number;
};

export type AtlasManualTaskContext = {
  farmId: string;
  object: { id: string; key: string; label: string; zoneId: string | null };
  canAuthor: boolean;
  viewerMembershipId: string | null;
  memberships: AtlasManualTaskMembership[];
  dayLoad: AtlasManualTaskDayLoad | null;
};

export type CreateAtlasManualTaskInput = {
  actionKind: AtlasManualTaskActionKind;
  title: string;
  currentTruth: string;
  afterTruth: string;
  unlockText?: string;
  effortClass: AtlasManualTaskEffort;
  assignedMembershipId: string;
  dueDate: string;
  workWindowKey: "first_thing" | "morning" | "midday" | "afternoon" | "evening";
  dateCommitment: AtlasManualTaskDateCommitment;
  bringIntoWorkNow: boolean;
  cropCycleIds?: string[];
};

type AtlasErrorShape = { error?: string | { message?: string }; details?: string };

async function json<T>(response: Response): Promise<T> {
  const data = await response.json() as T & AtlasErrorShape;
  if (!response.ok) {
    const error = typeof data.error === "string" ? data.error : data.error?.message;
    throw new Error(data.details || error || "Atlas request failed.");
  }
  return data;
}

export async function fetchAtlasManualTaskContext(
  objectKey: string,
  assignedMembershipId?: string,
  dueDate?: string,
) {
  const params = new URLSearchParams({ objectKey });
  if (assignedMembershipId) params.set("membershipId", assignedMembershipId);
  if (dueDate) params.set("dueDate", dueDate);
  const response = await fetch(`/api/atlas/manual-task?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await json<{ ok: boolean; context: AtlasManualTaskContext }>(response);
  return data.context;
}

export async function createAtlasManualTask(objectKey: string, input: CreateAtlasManualTaskInput) {
  const response = await fetch("/api/atlas/manual-task", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Atlas-Intent": "manual-task-authoring-v1",
    },
    body: JSON.stringify({
      objectKey,
      ...input,
      idempotencyKey: `manual-task:${objectKey}:${Date.now()}:${crypto.randomUUID()}`,
    }),
  });
  return json<{
    ok: boolean;
    taskId: string;
    deduplicated: boolean;
    task?: { id: string; title: string; dueDate: string; commitmentKind: AtlasManualTaskDateCommitment };
    object?: { id: string; key: string; label: string };
    assignee?: { membershipId: string; displayName: string };
    dayLoad?: AtlasManualTaskDayLoad;
  }>(response);
}
