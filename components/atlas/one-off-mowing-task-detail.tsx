import MowingFocusPage, { type MowingFocusTask } from "@/app/task-focus/[taskId]/MowingFocusPage";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  assignee: AtlasAssigneeConfig;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export default function OneOffMowingTaskDetail({ task, assignee }: Props) {
  const metadata = task.metadata ?? {};
  const resource = (task.resource_requirements ?? []).find((requirement) => {
    const key = requirement.resource_key?.toLowerCase() ?? "";
    const label = requirement.resource_label?.toLowerCase() ?? "";
    return key.includes("mower") || key.includes("battery") || label.includes("mower") || label.includes("battery");
  }) ?? null;
  const routeLabel = text(metadata.execution_place) || text(metadata.display_subject) || task.title;
  const zoneLabel = text(task.zone_label) || text(metadata.collection_zone) || "Elm Farm";

  const focus: MowingFocusTask = {
    id: task.task_id,
    title: task.title,
    dueDate: task.due_date,
    routeLabel,
    zoneLabel,
    equipmentGroup: text(metadata.equipment_group) || text(metadata.required_equipment) || null,
    resourceLabel: resource?.resource_label || null,
    resourceStatus: resource?.resource_status || resource?.status || null,
    targetCutHeightInches: numberOrNull(metadata.target_cut_height_inches),
    rhythmState: "one_off",
    warningAt: null,
    dueAt: null,
    failureAt: null,
    areaStatus: "task_defined",
    lastMowedAt: null,
    lastObservedAt: null,
    nextCheckDate: null,
    currentNote: task.note || null,
    canCloseRoute: false,
    resultMode: "canonical",
    actionKey: task.action_key || null,
    workClass: task.work_class || null,
    returnTo: assignee.listPath,
  };

  return <MowingFocusPage task={focus} />;
}
