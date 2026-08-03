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
const checklistVisualTimers = new Map<string, number>();
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

function checklistRow(taskId: string) {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-child-task-id="${CSS.escape(taskId)}"]`);
}

function currentChecklistVisualState(taskId: string): ChecklistVisualState | null {
  const row = checklistRow(taskId);
  if (!row) return null;
  return row.classList.contains("is-done") ? "done" : "open";
}

function checklistToggleButton(row: HTMLElement) {
  const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>(".atlas-plant-check__actions button"));
  return buttons.find((button) => {
    const label = button.textContent?.trim().toLowerCase();
    return label === "mark done" || label === "reopen";
  }) ?? buttons.at(-1) ?? null;
}

function setAttributeIfChanged(element: Element, name: string, value: string) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function applyChecklistVisualState(taskId: string, state: ChecklistVisualState) {
  const row = checklistRow(taskId);
  if (!row) return;

  const done = state === "done";
  if (row.classList.contains("is-done") !== done) row.classList.toggle("is-done", done);
  if (row.dataset.optimisticChecklistStatus !== state) row.dataset.optimisticChecklistStatus = state;

  const mark = row.querySelector<HTMLElement>(".atlas-plant-check__mark");
  if (mark) {
    const markText = done ? "✓" : "";
    if (mark.textContent !== markText) mark.textContent = markText;
    setAttributeIfChanged(mark, "aria-pressed", String(done));
    setAttributeIfChanged(mark, "aria-label", done ? "Reopen subtask" : "Mark subtask complete");
  }

  const button = checklistToggleButton(row);
  if (button) {
    const buttonText = done ? "Reopen" : "Mark done";
    if (button.textContent !== buttonText) button.textContent = buttonText;
    setAttributeIfChanged(button, "aria-label", done ? "Reopen subtask" : "Mark subtask complete");
  }
}

function ensureChecklistObserver() {
  if (typeof document === "undefined" || checklistObserver) return;

  checklistObserver = new MutationObserver(() => {
    checklistVisualStates.forEach((state, taskId) => applyChecklistVisualState(taskId, state));
  });

  checklistObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
    characterData: true,
  });
}

function forgetChecklistVisualState(taskId: string) {
  checklistVisualStates.delete(taskId);
  const timer = checklistVisualTimers.get(taskId);
  if (timer !== undefined && typeof window !== "undefined") window.clearTimeout(timer);
  checklistVisualTimers.delete(taskId);

  if (!checklistVisualStates.size && checklistObserver) {
    checklistObserver.disconnect();
    checklistObserver = null;
  }
}

function rememberChecklistVisualState(taskId: string, state: ChecklistVisualState) {
  if (typeof window === "undefined") return;

  checklistVisualStates.set(taskId, state);
  ensureChecklistObserver();
  applyChecklistVisualState(taskId, state);

  const priorTimer = checklistVisualTimers.get(taskId);
  if (priorTimer !== undefined) window.clearTimeout(priorTimer);
  const timer = window.setTimeout(() => forgetChecklistVisualState(taskId), 60000);
  checklistVisualTimers.set(taskId, timer);
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

function safeAtlasReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/task")) return null;
  return value;
}

function completedTaskReturnPath() {
  const params = new URLSearchParams(window.location.search);
  const requested = safeAtlasReturnPath(params.get("returnTo"));
  if (requested) return requested;

  if (document.referrer) {
    try {
      const referrer = new URL(document.referrer);
      const path = safeAtlasReturnPath(`${referrer.pathname}${referrer.search}${referrer.hash}`);
      if (referrer.origin === window.location.origin && path) return path;
    } catch {
      // Ignore malformed or cross-origin referrers and use the canonical Work return.
    }
  }

  return "/";
}

function leaveCompletedTaskPage() {
  if (typeof window === "undefined" || window.location.pathname !== "/task") return;
  const destination = completedTaskReturnPath();

  // A fresh document navigation is intentional. Safari and installed PWAs may
  // restore the previous feed from the back-forward cache when history.back()
  // is used, leaving a successfully completed task visible and clickable.
  window.setTimeout(() => window.location.replace(destination), 0);
}

export async function postAtlasTaskTransition(input: AtlasTaskTransitionRequest): Promise<AtlasTaskTransitionResponse> {
  const optimisticChecklistState: ChecklistVisualState | null = input.transition === "checklist_done"
    ? "done"
    : input.transition === "checklist_open"
      ? "open"
      : null;
  const previousChecklistState = optimisticChecklistState && typeof window !== "undefined"
    ? currentChecklistVisualState(input.taskId)
    : null;

  if (optimisticChecklistState) rememberChecklistVisualState(input.taskId, optimisticChecklistState);

  try {
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

    if (input.transition === "done" || input.transition === "checklist_done") {
      rememberDependencyReleaseFlash(data);
    }
    if (input.transition === "done") {
      leaveCompletedTaskPage();
    }

    return data;
  } catch (error) {
    if (optimisticChecklistState) {
      if (previousChecklistState) rememberChecklistVisualState(input.taskId, previousChecklistState);
      else forgetChecklistVisualState(input.taskId);
    }
    throw error;
  }
}
