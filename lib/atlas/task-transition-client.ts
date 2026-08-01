export type AtlasTaskTransition =
  | "done"
  | "partial"
  | "blocked"
  | "not_relevant"
  | "changed_plan"
  | "rescheduled"
  | "unfinished"
  | "reopened"
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

export type AtlasTaskDependency = {
  clockId: string;
  direction: "downstream" | "upstream";
  state: "waiting" | "counting" | "ready" | "released" | "completed" | "cancelled";
  sourceTaskId: string;
  sourceTaskTitle: string;
  downstreamOccurrenceId: string;
  downstreamTaskId: string | null;
  downstreamTitle: string;
  sourceSatisfiedAt: string | null;
  readyAt: string | null;
  releasedAt: string | null;
  delaySeconds: number;
  resultGatePath: string[] | null;
  resultGateEquals: unknown;
  notificationPolicy: Record<string, unknown>;
};

export type AtlasTaskDependencyStatus = {
  taskId: string;
  dependencies: AtlasTaskDependency[];
};

export type AtlasDependencyReleaseFlash = {
  sourceTitle: string;
  downstreamTitle: string;
  state: AtlasTaskDependency["state"];
  readyAt: string | null;
};

type AtlasApiError = string | {
  code?: string;
  message?: string;
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
  dependencyStatus?: AtlasTaskDependencyStatus | null;
  error?: AtlasApiError;
  details?: string;
};

type ChecklistVisualState = "done" | "open";

export const ATLAS_DEPENDENCY_RELEASE_FLASH_KEY = "atlas:dependency-release-flash:v1";

const checklistVisualStates = new Map<string, ChecklistVisualState>();
let checklistObserver: MutationObserver | null = null;

function transitionKey(taskId: string, transition: AtlasTaskTransition) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `atlas:${taskId}:${transition}:${nonce}`;
}

function scopedTransitionKey(input: AtlasTaskTransitionRequest) {
  const baseKey = input.idempotencyKey ?? transitionKey(input.taskId, input.transition);
  return baseKey.startsWith(`${input.taskId}:`) ? baseKey : `${input.taskId}:${baseKey}`;
}

function taskTransitionError(data: AtlasTaskTransitionResponse) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  if (data.error?.message) return data.error.message;
  return "Task update failed.";
}

function checklistToggleButton(row: HTMLElement) {
  const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>(".atlas-plant-check__actions button"));
  return buttons.find((button) => {
    const label = button.textContent?.trim().toLowerCase();
    return label === "mark done" || label === "reopen";
  }) ?? buttons.at(-1) ?? null;
}

function applyChecklistVisualState(taskId: string, state: ChecklistVisualState) {
  if (typeof document === "undefined") return;

  const row = document.querySelector<HTMLElement>(`[data-child-task-id="${CSS.escape(taskId)}"]`);
  if (!row) return;

  const done = state === "done";
  row.classList.toggle("is-done", done);
  row.dataset.optimisticChecklistStatus = state;

  const mark = row.querySelector<HTMLElement>(".atlas-plant-check__mark");
  if (mark) {
    mark.textContent = done ? "✓" : "";
    mark.setAttribute("aria-pressed", String(done));
    mark.setAttribute("aria-label", done ? "Reopen subtask" : "Mark subtask complete");
  }

  const button = checklistToggleButton(row);
  if (button) {
    button.textContent = done ? "Reopen" : "Mark done";
    button.setAttribute("aria-label", done ? "Reopen subtask" : "Mark subtask complete");
  }
}

function ensureChecklistObserver() {
  if (typeof document === "undefined" || checklistObserver) return;

  checklistObserver = new MutationObserver(() => {
    checklistVisualStates.forEach((state, taskId) => applyChecklistVisualState(taskId, state));
  });

  checklistObserver.observe(document.body, { childList: true, subtree: true });
}

function rememberChecklistVisualState(taskId: string, state: ChecklistVisualState) {
  checklistVisualStates.set(taskId, state);
  ensureChecklistObserver();
  applyChecklistVisualState(taskId, state);

  window.setTimeout(() => {
    checklistVisualStates.delete(taskId);
    if (!checklistVisualStates.size && checklistObserver) {
      checklistObserver.disconnect();
      checklistObserver = null;
    }
  }, 10000);
}

function rememberDependencyReleaseFlash(data: AtlasTaskTransitionResponse) {
  if (typeof window === "undefined") return;
  const dependency = data.dependencyStatus?.dependencies.find((item) => (
    item.direction === "downstream"
    && (item.state === "counting" || item.state === "ready" || item.state === "released")
  ));
  if (!dependency) return;

  const flash: AtlasDependencyReleaseFlash = {
    sourceTitle: dependency.sourceTaskTitle,
    downstreamTitle: dependency.downstreamTitle,
    state: dependency.state,
    readyAt: dependency.readyAt,
  };
  window.sessionStorage.setItem(ATLAS_DEPENDENCY_RELEASE_FLASH_KEY, JSON.stringify(flash));
}

export async function postAtlasTaskTransition(input: AtlasTaskTransitionRequest): Promise<AtlasTaskTransitionResponse> {
  const response = await fetch("/api/atlas/task-transition", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "task-transition-v1",
    },
    cache: "no-store",
    body: JSON.stringify({
      ...input,
      idempotencyKey: scopedTransitionKey(input),
    }),
  });
  const data = await response.json() as AtlasTaskTransitionResponse;
  if (!response.ok || !data.ok) throw new Error(taskTransitionError(data));

  if (typeof window !== "undefined" && input.transition === "checklist_done") {
    rememberChecklistVisualState(input.taskId, "done");
  } else if (typeof window !== "undefined" && input.transition === "checklist_open") {
    rememberChecklistVisualState(input.taskId, "open");
  }

  if (input.transition === "done" || input.transition === "checklist_done") {
    rememberDependencyReleaseFlash(data);
  }

  return data;
}
