import type { AtlasWorkerDayProjectionRead } from "@/lib/atlas/worker-day-projection-client";
import type { AtlasTaskTransition } from "@/lib/atlas/task-transition-client";

export type AtlasRuntimePendingTaskTransition = {
  actionId: string;
  kind: "task_transition";
  serviceDate: string;
  taskId: string;
  transition: AtlasTaskTransition;
  phase: "committing" | "reconciling";
};

export type AtlasRuntimePendingAction = AtlasRuntimePendingTaskTransition;

function optimisticTaskStatus(transition: AtlasTaskTransition) {
  if (transition === "done") return "done";
  if (transition === "reopened") return "open";
  return null;
}

export function applyAtlasRuntimePendingActions(
  canonical: AtlasWorkerDayProjectionRead | null,
  pendingActions: AtlasRuntimePendingAction[],
): AtlasWorkerDayProjectionRead | null {
  if (!canonical || !pendingActions.length) return canonical;

  const statusByTaskId = new Map<string, string>();
  for (const action of pendingActions) {
    if (action.kind !== "task_transition") continue;
    const status = optimisticTaskStatus(action.transition);
    if (status) statusByTaskId.set(action.taskId, status);
  }
  if (!statusByTaskId.size) return canonical;

  const sequence = canonical.projection.sequence;
  const items = sequence.items.map((item) => {
    if ((item.kind !== "committed_task" && item.kind !== "potential_task") || !item.taskId) return item;
    const status = statusByTaskId.get(item.taskId);
    return status ? { ...item, status } : item;
  });

  return {
    ...canonical,
    projection: {
      ...canonical.projection,
      // The canonical revision does not advance until the server read reconciles.
      sequence: { ...sequence, items },
    },
  };
}
