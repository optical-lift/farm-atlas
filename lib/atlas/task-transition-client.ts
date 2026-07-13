export type AtlasTaskTransition =
  | "done"
  | "partial"
  | "blocked"
  | "not_relevant"
  | "changed_plan"
  | "rescheduled"
  | "unfinished"
  | "checklist_done"
  | "checklist_open"
  | "note";

export type AtlasTaskTransitionRequest = {
  taskId: string;
  transition: AtlasTaskTransition;
  idempotencyKey?: string;
  targetDate?: string | null;
  note?: string | null;
  reason?: string | null;
  laneKey?: string | null;
  workKey?: string | null;
  payload?: Record<string, unknown>;
  existingFieldLogId?: string | null;
};

export type AtlasTaskTransitionResponse = {
  ok: boolean;
  transitionId: string;
  taskId: string;
  status: string;
  fieldLogId: string | null;
  taskOutcomeEventId: string | null;
  childTaskIds: string[];
  childrenClosed: number;
  nextTaskId: string | null;
  deduplicated: boolean;
  warnings: string[];
  error?: string;
  details?: string;
};

function transitionKey(taskId: string, transition: AtlasTaskTransition) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `atlas:${taskId}:${transition}:${nonce}`;
}

export async function postAtlasTaskTransition(input: AtlasTaskTransitionRequest): Promise<AtlasTaskTransitionResponse> {
  const response = await fetch("/api/atlas/task-transition", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "task-transition-v1",
    },
    body: JSON.stringify({
      ...input,
      idempotencyKey: input.idempotencyKey ?? transitionKey(input.taskId, input.transition),
    }),
  });
  const data = await response.json() as AtlasTaskTransitionResponse;
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Task update failed.");
  return data;
}
