import type { TaskMoveAssembly, TaskMoveUnresolvedItem } from "@/lib/atlas/task-move-assembly";

export type WorkerTaskBlockedReason =
  | "resource"
  | "prerequisite"
  | "readiness";

export type WorkerTaskBlockedPresentation = {
  blocked: boolean;
  reasonKind: WorkerTaskBlockedReason | null;
  heading: string | null;
  reason: string | null;
  nextStep: string | null;
};

const RESOURCE_KINDS = new Set<TaskMoveUnresolvedItem["kind"]>([
  "resource",
  "container",
  "medium",
  "source",
  "destination",
  "capacity",
]);

const PREREQUISITE_KINDS = new Set<TaskMoveUnresolvedItem["kind"]>([
  "dependency",
  "prerequisite",
]);

/**
 * Translate canonical execution readiness into the smallest truthful Worker message.
 *
 * This intentionally does not surface unresolved labels, resource keys, state names,
 * policy names, consequences, database identifiers, or management actions. Those are
 * diagnostic/management truth, not Worker instructions.
 */
export function workerTaskBlockedPresentation(
  assembly: TaskMoveAssembly | null,
): WorkerTaskBlockedPresentation {
  if (!assembly) {
    return {
      blocked: false,
      reasonKind: null,
      heading: null,
      reason: null,
      nextStep: null,
    };
  }

  const blocked =
    assembly.readiness.executable === false ||
    assembly.readiness.status === "blocked" ||
    assembly.spine.connection === "stops_at_move";

  if (!blocked) {
    return {
      blocked: false,
      reasonKind: null,
      heading: null,
      reason: null,
      nextStep: null,
    };
  }

  const unresolved = assembly.unresolved.filter(
    (item) => item.status === "blocked" || item.status === "missing",
  );
  const hasResourceBlock = unresolved.some((item) => RESOURCE_KINDS.has(item.kind));
  const hasPrerequisiteBlock = unresolved.some((item) => PREREQUISITE_KINDS.has(item.kind));

  const reasonKind: WorkerTaskBlockedReason = hasResourceBlock
    ? "resource"
    : hasPrerequisiteBlock
      ? "prerequisite"
      : "readiness";

  const reason = reasonKind === "resource"
    ? "The equipment or supply this work needs isn’t ready yet."
    : reasonKind === "prerequisite"
      ? "Another step needs to happen before this one."
      : "This work isn’t ready to start yet.";

  return {
    blocked: true,
    reasonKind,
    heading: "Not ready to start yet",
    reason,
    nextStep: "You don’t need to do anything with this task right now. Atlas will bring it back when it’s ready.",
  };
}
