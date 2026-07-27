import type { TendingBedTrack } from "@/lib/atlas/tending-client";

export type AtlasTrailNodeStatus =
  | "complete"
  | "current"
  | "projected"
  | "blocked"
  | "care"
  | "skipped"
  | "unresolved";

export type AtlasTrailNode = {
  nodeId: string;
  nodeKey: string;
  label: string;
  status: AtlasTrailNodeStatus;
  nodeKind: "milestone" | "care_pulse" | "review" | "decision" | "terminal" | string;
  occurredOn?: string | null;
  dueOn?: string | null;
  taskId?: string | null;
  href?: string | null;
  evidenceCount?: number;
  note?: string | null;
};

export type AtlasTrailMoveRef = {
  kind: string;
  taskId?: string | null;
  title: string;
  status?: string | null;
  dueDate?: string | null;
  href?: string | null;
};

export type AtlasTrailBlocker = {
  kind: string;
  title: string;
  detail?: string | null;
  dueDate?: string | null;
};

export type AtlasTrailContext = {
  trailId: string;
  profileKey: string;
  profileLabel?: string | null;
  subject: {
    kind: string;
    id: string;
    label: string;
    farmId?: string | null;
  };
  nodes: AtlasTrailNode[];
  currentNodeId: string | null;
  currentMove: AtlasTrailMoveRef | null;
  nextNode: AtlasTrailNode | null;
  blocker: AtlasTrailBlocker | null;
  unresolvedEvidenceCount: number;
  evidenceCount?: number;
  lastMovedAt?: string | null;
};

function tendingStatus(status: TendingBedTrack["gates"][number]["status"]): AtlasTrailNodeStatus {
  if (status === "complete") return "complete";
  if (status === "current") return "current";
  if (status === "blocked") return "blocked";
  if (status === "skipped") return "skipped";
  return "projected";
}

export function atlasTrailFromTendingTrack(
  track: TendingBedTrack,
  currentHref: string | null = null,
): AtlasTrailContext {
  const trailId = `crop-cycle:${track.cropCycleId || track.bedKey}`;
  const nodes: AtlasTrailNode[] = track.gates.map((gate, index) => ({
    nodeId: `${trailId}:${gate.key}:${index}`,
    nodeKey: gate.key,
    label: gate.label,
    status: tendingStatus(gate.status),
    nodeKind: "milestone",
    dueOn: gate.dueDate ?? null,
    taskId: gate.status === "current" ? gate.taskId ?? null : null,
    href: gate.status === "current" ? currentHref : null,
  }));
  const currentNode = nodes.find((node) => node.status === "current" || node.status === "blocked") ?? null;
  const currentIndex = currentNode ? nodes.findIndex((node) => node.nodeId === currentNode.nodeId) : -1;
  const nextNode = nodes.slice(currentIndex + 1).find((node) => node.status === "projected") ?? null;

  return {
    trailId,
    profileKey: "crop_cycle",
    profileLabel: "Crop Trail",
    subject: {
      kind: "crop_cycle",
      id: track.cropCycleId || track.bedKey,
      label: track.cropLabel,
    },
    nodes,
    currentNodeId: currentNode?.nodeId ?? null,
    currentMove: currentNode && track.releasedTaskId ? {
      kind: "farm_task",
      taskId: track.releasedTaskId,
      title: track.taskTitle || currentNode.label,
      status: currentNode.status,
      dueDate: track.taskDueDate || currentNode.dueOn || null,
      href: currentHref,
    } : null,
    nextNode,
    blocker: currentNode?.status === "blocked" ? {
      kind: "blocked_move",
      title: track.taskTitle || currentNode.label,
      detail: "The current released move is blocked.",
    } : null,
    unresolvedEvidenceCount: 0,
    lastMovedAt: null,
  };
}

export function atlasTrailCurrentNode(context: AtlasTrailContext | null | undefined) {
  if (!context) return null;
  return context.nodes.find((node) => node.nodeId === context.currentNodeId)
    ?? context.nodes.find((node) => node.status === "current" || node.status === "blocked")
    ?? null;
}
