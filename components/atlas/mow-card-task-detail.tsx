import MowingFocusPage, { type MowingFocusTask } from "@/app/task-focus/[taskId]/MowingFocusPage";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function routeLabel(task: AtlasTaskCard) {
  return text(task.metadata?.display_subject)
    || text(task.metadata?.collection_label)
    || text(task.metadata?.display_location)
    || task.title.replace(/^Mowing\s*[—-]\s*/i, "").replace(/^Mow\s*[—-]\s*/i, "").trim()
    || "Mowing route";
}

export default function MowCardTaskDetail({ task, assignee }: { task: AtlasTaskCard; assignee: AtlasAssigneeConfig }) {
  const resource = task.resource_requirements.find((item) => item.requirement_role === "required")
    ?? task.resource_requirements[0]
    ?? null;

  const focus: MowingFocusTask = {
    id: task.task_id,
    title: task.title,
    dueDate: task.due_date,
    routeLabel: routeLabel(task),
    zoneLabel: task.zone_label
      || text(task.metadata?.collection_zone)
      || text(task.metadata?.display_location)
      || "Elm Farm",
    equipmentGroup: text(task.metadata?.equipment_group) || resource?.resource_label || null,
    resourceLabel: resource?.resource_label || null,
    resourceStatus: resource?.resource_status || resource?.status || null,
    targetCutHeightInches: numberOrNull(task.metadata?.target_cut_height_inches),
    rhythmState: "uninitialized",
    warningAt: null,
    dueAt: null,
    failureAt: null,
    areaStatus: "unassessed",
    lastMowedAt: null,
    lastObservedAt: null,
    nextCheckDate: null,
    currentNote: task.note,
    canCloseRoute: false,
    returnTo: assignee.listPath,
  };

  return <MowingFocusPage task={focus} />;
}
