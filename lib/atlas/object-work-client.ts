export type AtlasObjectWorkActionKind =
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

export type AtlasObjectWorkDateCommitment = "hard_date" | "floating";
export type AtlasObjectWorkLane = "required" | "process_continuation" | "rhythm" | "discretionary";
export type AtlasObjectWorkEffort = "light" | "standard" | "heavy";

export type AtlasObjectWorkMembership = {
  membershipId: string;
  role: string;
  workerKey: string | null;
  displayName: string;
  activeTaskCount: number;
};

export type AtlasObjectWorkDayLoad = {
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

export type AtlasObjectWorkStep = {
  id: string;
  position: number;
  title: string;
  complete: boolean;
  completedAt: string | null;
};

export type AtlasObjectWorkItem = {
  id: string;
  actionKind: AtlasObjectWorkActionKind;
  actionLabel: string;
  title: string;
  instructions: string | null;
  doneDefinition: string;
  unlockText: string | null;
  effortClass: AtlasObjectWorkEffort;
  effortUnits: number;
  dueDate: string;
  workWindowKey: string;
  releaseLocalTime: string;
  closeLocalTime: string | null;
  releaseMode: "put_in_work" | "hold_for_capacity";
  dateCommitment: AtlasObjectWorkDateCommitment;
  workLane: AtlasObjectWorkLane;
  bringIntoWorkNow: boolean;
  status: "planned" | "released" | "completed" | "cancelled";
  plannedOccurrenceId: string | null;
  taskId: string | null;
  assignee: AtlasObjectWorkMembership;
  steps: AtlasObjectWorkStep[];
  cropCycles: Array<{
    id: string;
    label: string;
    variety: string | null;
    state: string;
    role: string;
  }>;
  object: { id: string; key: string; label: string; type: string };
  createdAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown>;
};

export type AtlasObjectWorkContext = {
  object: { id: string; key: string; label: string; type: string };
  viewerRole: string;
  viewerMembershipId: string;
  canAuthor: boolean;
  systemSafety: {
    activeTopLevel: number;
    circuitBreaker: number;
    circuitBreakerReached: boolean;
  };
  dayLoad: AtlasObjectWorkDayLoad | null;
  memberships: AtlasObjectWorkMembership[];
  workItems: AtlasObjectWorkItem[];
};

export type CreateAtlasObjectWorkInput = {
  actionKind: AtlasObjectWorkActionKind;
  title: string;
  instructions?: string;
  doneDefinition: string;
  unlockText?: string;
  effortClass: AtlasObjectWorkEffort;
  assignedMembershipId: string;
  dueDate: string;
  workWindowKey: "first_thing" | "morning" | "midday" | "afternoon" | "evening";
  dateCommitment: AtlasObjectWorkDateCommitment;
  bringIntoWorkNow: boolean;
  cropCycleIds?: string[];
  steps?: string[];
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

export async function fetchAtlasObjectWorkContext(
  objectKey: string,
  assignedMembershipId?: string,
  dueDate?: string,
) {
  const params = new URLSearchParams();
  if (assignedMembershipId) params.set("membershipId", assignedMembershipId);
  if (dueDate) params.set("dueDate", dueDate);
  const query = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`/api/atlas/objects/${encodeURIComponent(objectKey)}/work${query}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await json<{ ok: boolean; context: AtlasObjectWorkContext }>(response);
  return data.context;
}

export async function createAtlasObjectWork(objectKey: string, input: CreateAtlasObjectWorkInput) {
  const response = await fetch(`/api/atlas/objects/${encodeURIComponent(objectKey)}/work`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Atlas-Intent": "object-work-authoring-v2",
    },
    body: JSON.stringify({
      ...input,
      idempotencyKey: `object-work:${objectKey}:${Date.now()}:${crypto.randomUUID()}`,
    }),
  });
  return json<{
    ok: boolean;
    workItem: AtlasObjectWorkItem;
    taskId: string | null;
    plannedOccurrenceId: string;
    dayLoad: AtlasObjectWorkDayLoad;
  }>(response);
}

export async function cancelAtlasObjectWorkPlan(objectKey: string, workItemId: string) {
  const response = await fetch(`/api/atlas/objects/${encodeURIComponent(objectKey)}/work`, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Atlas-Intent": "cancel-object-work-plan-v1",
    },
    body: JSON.stringify({ workItemId }),
  });
  return json<{ ok: boolean; workItem: AtlasObjectWorkItem }>(response);
}

export async function fetchAtlasObjectWorkForTask(taskId: string) {
  const response = await fetch(`/api/atlas/object-work?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await json<{ ok: boolean; workItem: AtlasObjectWorkItem | null }>(response);
  return data.workItem;
}

export async function setAtlasObjectWorkStep(stepId: string, complete: boolean) {
  const response = await fetch("/api/atlas/object-work", {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Atlas-Intent": "object-work-step-v1",
    },
    body: JSON.stringify({ stepId, complete }),
  });
  const data = await json<{ ok: boolean; workItem: AtlasObjectWorkItem }>(response);
  return data.workItem;
}
