export type AtlasMaintenanceKind = "weed" | "mow";
export type AtlasMaintenanceDirectiveKind = "instruction" | "prerequisite";
export type AtlasMaintenanceEffectPolicy =
  | "bring_forward_only"
  | "target_condition"
  | "full_maintenance"
  | "inspection_only";

export type AtlasMaintenanceMembership = {
  membershipId: string;
  role: string;
  workerKey: string | null;
  displayName: string;
};

export type AtlasMaintenanceDirectiveStep = {
  id: string;
  position: number;
  title: string;
  complete: boolean;
  completedAt: string | null;
};

export type AtlasMaintenanceDirective = {
  id: string;
  maintenanceKind: AtlasMaintenanceKind;
  directiveKind: AtlasMaintenanceDirectiveKind;
  title: string;
  instructions: string | null;
  effectPolicy: AtlasMaintenanceEffectPolicy;
  targetCondition: string | null;
  dueDate: string;
  workWindowKey: string;
  releaseLocalTime: string;
  closeLocalTime: string | null;
  status: "active" | "completed" | "cancelled";
  servingTaskId: string | null;
  prerequisiteTaskId: string | null;
  assignee: AtlasMaintenanceMembership;
  steps: AtlasMaintenanceDirectiveStep[];
  cropCycles: Array<{
    id: string;
    label: string;
    variety: string | null;
    state: string;
    role: string;
  }>;
  createdAt: string;
  completedAt: string | null;
};

export type AtlasMaintenanceDirectiveContext = {
  object: { id: string; key: string; label: string; type: string };
  viewerRole: string;
  viewerMembershipId: string;
  canAuthor: boolean;
  capabilities: { weed: boolean; mow: boolean };
  cards: {
    weed?: {
      cardId: string | null;
      currentCondition: string | null;
      targetCondition: string | null;
      servingTaskId: string | null;
    } | null;
    mow?: {
      rhythmStateId: string;
      state: string;
      servingTaskId: string | null;
      targetCutHeightInches: string | null;
    } | null;
  };
  memberships: AtlasMaintenanceMembership[];
  directives: AtlasMaintenanceDirective[];
};

export type CreateAtlasMaintenanceDirectiveInput = {
  maintenanceKind: AtlasMaintenanceKind;
  directiveKind: AtlasMaintenanceDirectiveKind;
  title: string;
  instructions?: string;
  assignedMembershipId: string;
  dueDate: string;
  workWindowKey: "first_thing" | "morning" | "midday" | "afternoon" | "evening";
  effectPolicy: AtlasMaintenanceEffectPolicy;
  targetCondition?: string;
  cropCycleIds?: string[];
  steps?: string[];
};

async function json<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: { message?: string } | string; details?: string };
  if (!response.ok) {
    const error = typeof data.error === "string" ? data.error : data.error?.message;
    throw new Error(data.details || error || "Atlas request failed.");
  }
  return data;
}

export async function fetchAtlasMaintenanceDirectiveContext(objectKey: string) {
  const response = await fetch(`/api/atlas/objects/${encodeURIComponent(objectKey)}/maintenance-directives`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await json<{ ok: boolean; context: AtlasMaintenanceDirectiveContext }>(response);
  return data.context;
}

export async function createAtlasMaintenanceDirective(
  objectKey: string,
  input: CreateAtlasMaintenanceDirectiveInput,
) {
  const response = await fetch(`/api/atlas/objects/${encodeURIComponent(objectKey)}/maintenance-directives`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Atlas-Intent": "object-maintenance-directive-v1",
    },
    body: JSON.stringify({
      ...input,
      idempotencyKey: `maintenance-directive:${objectKey}:${Date.now()}:${crypto.randomUUID()}`,
    }),
  });
  return json<{ ok: boolean; directive: AtlasMaintenanceDirective; servingTaskId: string | null; prerequisiteTaskId: string | null }>(response);
}

export async function cancelAtlasMaintenanceDirective(objectKey: string, directiveId: string) {
  const response = await fetch(`/api/atlas/objects/${encodeURIComponent(objectKey)}/maintenance-directives`, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Atlas-Intent": "cancel-maintenance-directive-v1",
    },
    body: JSON.stringify({ directiveId }),
  });
  return json<{ ok: boolean; directive: AtlasMaintenanceDirective }>(response);
}

export async function fetchAtlasMaintenanceDirectivesForTask(taskId: string) {
  const response = await fetch(`/api/atlas/maintenance-directives?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await json<{ ok: boolean; directives: AtlasMaintenanceDirective[] }>(response);
  return data.directives;
}

export async function setAtlasMaintenanceDirectiveStep(stepId: string, completed: boolean) {
  const response = await fetch("/api/atlas/maintenance-directives", {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Atlas-Intent": "maintenance-directive-step-v1",
    },
    body: JSON.stringify({ stepId, completed }),
  });
  const data = await json<{ ok: boolean; directive: AtlasMaintenanceDirective }>(response);
  return data.directive;
}
