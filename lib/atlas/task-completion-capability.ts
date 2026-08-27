import type { TaskMoveAssembly } from "@/lib/atlas/task-move-assembly";

export type AtlasTaskCompletionCapabilityState = "available" | "loading" | "blocked";

export type AtlasTaskCompletionBlockReason =
  | "explicitly_disabled"
  | "task_blocked"
  | "blocking_move_fact"
  | "stateful_child_open"
  | "move_loading"
  | "move_unavailable"
  | "move_blocked"
  | "move_not_executable"
  | "move_stops_at_move";

export type AtlasTaskCompletionCapability = {
  version: 1;
  state: AtlasTaskCompletionCapabilityState;
  canComplete: boolean;
  reasons: AtlasTaskCompletionBlockReason[];
  message: string | null;
};

export type AtlasTaskCompletionCapabilityInput = {
  taskStatus: string | null | undefined;
  assembly: TaskMoveAssembly | null;
  assemblyLoading: boolean;
  explicitlyDisabled?: boolean;
  hasOpenStatefulChildren?: boolean;
};

const REASON_MESSAGES: Record<AtlasTaskCompletionBlockReason, string> = {
  explicitly_disabled: "This task is not ready to be completed yet.",
  task_blocked: "Resolve the task blocker before completing this task.",
  blocking_move_fact: "Resolve the blocked execution requirement before completing this task.",
  stateful_child_open: "Finish the required child work before completing this task.",
  move_loading: "Atlas is still checking whether this task can be completed.",
  move_unavailable: "Atlas could not verify the execution requirements for this task.",
  move_blocked: "Resolve the blocked execution requirements before completing this task.",
  move_not_executable: "This task is not executable yet.",
  move_stops_at_move: "This task stops at the current move and cannot be completed yet.",
};

function addReason(reasons: AtlasTaskCompletionBlockReason[], reason: AtlasTaskCompletionBlockReason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

/**
 * Canonical completion capability for a task-transition execution surface.
 *
 * Renderers may explain this capability, but they must not independently widen it.
 * Domain-result and aggregate workflows may use different completion authorities;
 * this contract governs the ordinary task-transition completion path exposed by
 * AssignedTaskExecutionShell and the family result instruments mounted inside it.
 */
export function resolveAtlasTaskCompletionCapability(
  input: AtlasTaskCompletionCapabilityInput,
): AtlasTaskCompletionCapability {
  const reasons: AtlasTaskCompletionBlockReason[] = [];

  if (input.explicitlyDisabled) addReason(reasons, "explicitly_disabled");
  if (input.taskStatus === "blocked") addReason(reasons, "task_blocked");
  if (input.hasOpenStatefulChildren) addReason(reasons, "stateful_child_open");

  if (!input.assembly) {
    addReason(reasons, input.assemblyLoading ? "move_loading" : "move_unavailable");
  } else {
    if (input.assembly.unresolved.some((item) => item.status === "blocked")) {
      addReason(reasons, "blocking_move_fact");
    }
    if (input.assembly.readiness.status === "blocked") addReason(reasons, "move_blocked");
    if (input.assembly.readiness.executable !== true) addReason(reasons, "move_not_executable");
    if (input.assembly.spine.connection === "stops_at_move") addReason(reasons, "move_stops_at_move");
  }

  const blockingReasons = reasons.filter((reason) => reason !== "move_loading");
  const state: AtlasTaskCompletionCapabilityState = blockingReasons.length
    ? "blocked"
    : reasons.includes("move_loading")
      ? "loading"
      : "available";

  return {
    version: 1,
    state,
    canComplete: state === "available",
    reasons,
    message: reasons.length ? REASON_MESSAGES[reasons[0]] : null,
  };
}
