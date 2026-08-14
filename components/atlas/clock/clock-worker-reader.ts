import {
  assembleWorkerDaySequence,
  type AtlasDaySequenceCueInput,
  type AtlasDaySequencePlacementInput,
  type AtlasDaySequencePlanRowInput,
  type AtlasDaySequenceWindow,
} from "@/lib/atlas/day-sequence";
import { buildAtlasWorkerDayProjection, type AtlasWorkerDayProjectionLens } from "@/lib/atlas/day-projection";
import { atlasFarmDateIso } from "@/lib/atlas/farm-day";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import { deriveAtlasTimingMobility } from "@/lib/atlas/timing-mobility";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasWorkOrderAnchorForTask, atlasWorkOrderNumber } from "@/lib/atlas/work-order";

type ChoreographyResponse = {
  ok?: boolean;
  active?: boolean;
  target?: {
    farmId?: string;
    membershipId?: string;
    source?: AtlasWorkerDayProjectionLens;
  } | null;
  choreography?: { placements?: AtlasDaySequencePlacementInput[]; cues?: AtlasDaySequenceCueInput[] } | null;
};

function isChildTask(task: AtlasTaskCard) {
  return Boolean(task.parent_task_id) || task.metadata?.is_child_task === true || task.metadata?.is_child_task === "true";
}

function dayWindowForTask(task: AtlasTaskCard): AtlasDaySequenceWindow {
  const anchor = atlasWorkOrderAnchorForTask(task);
  if (anchor === "top" || anchor === "morning") return "morning";
  if (anchor === "midday" || anchor === "visibility") return "afternoon";
  return "evening";
}

function metadataMinutes(task: AtlasTaskCard) {
  for (const key of ["expected_active_minutes", "estimated_minutes", "duration_minutes"]) {
    const parsed = Number(task.metadata?.[key]);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return null;
}

function planRow(task: AtlasTaskCard): AtlasDaySequencePlanRowInput {
  const display = atlasTaskDisplay(task);
  const location = task.zone_label || display.location || null;
  return {
    id: `clock:${task.task_id}`,
    kind: "real",
    sourceKind: "task",
    sourceId: task.task_id,
    taskId: task.task_id,
    title: display.title,
    note: display.detail || task.note,
    status: task.status,
    location,
    expectedActiveMinutes: metadataMinutes(task),
    dayWindow: dayWindowForTask(task),
    workOrderNumber: atlasWorkOrderNumber(task),
    automatic: false,
    requiresOwnerApproval: false,
    mobility: deriveAtlasTimingMobility({ metadata: task.metadata, location, potential: false }),
  };
}

export async function readWorkerClockProjection(dateIso: string) {
  const today = atlasFarmDateIso();
  const [tasks, choreographyRequest] = await Promise.all([
    fetchAtlasTaskCards({ viewerScoped: true, dueThrough: dateIso, doneDate: dateIso, exactDate: dateIso > today ? dateIso : undefined }),
    fetch(`/api/atlas/day-choreography?date=${encodeURIComponent(dateIso)}`, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } }),
  ]);
  const choreographyBody = await choreographyRequest.json() as ChoreographyResponse;
  if (!choreographyRequest.ok || !choreographyBody.ok || !choreographyBody.active) throw new Error("Atlas could not load the worker Day choreography.");
  const target = choreographyBody.target;
  if (!target?.farmId || !target.membershipId || !target.source) throw new Error("Atlas could not identify the worker Day projection.");
  const sequence = assembleWorkerDaySequence({
    serviceDate: dateIso,
    realWork: tasks.taskCards.filter((task) => task.status !== "archived" && task.status !== "skipped" && !isChildTask(task)).map(planRow),
    suggestions: [],
    placements: choreographyBody.choreography?.placements ?? [],
    cues: choreographyBody.choreography?.cues ?? [],
  });
  return buildAtlasWorkerDayProjection({
    farmId: target.farmId,
    membershipId: target.membershipId,
    serviceDate: dateIso,
    lens: target.source,
    sequence,
  });
}

// Compatibility seam for callers that still need the sequence while Clock migrates to projections.
export async function readWorkerClockSequence(dateIso: string) {
  const projection = await readWorkerClockProjection(dateIso);
  return projection.sequence;
}
