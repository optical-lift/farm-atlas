import { ATLAS_ASSIGNEES_CORE, assignedTaskHrefCore, resolveTaskAssigneeCore } from "./task-assignment-core";

export type AtlasAssigneeKey = "owner" | "marshall" | "kids" | "farm_team" | "anna";

export type AtlasAssigneeConfig = {
  key: AtlasAssigneeKey;
  label: string;
  listPath: string;
  secondaryAction: "tomorrow" | "unfinished";
};

export const ATLAS_ASSIGNEES = ATLAS_ASSIGNEES_CORE as Record<AtlasAssigneeKey, AtlasAssigneeConfig>;

type AssignmentTask = {
  metadata?: Record<string, unknown> | null;
};

export function resolveTaskAssignee(task: AssignmentTask): AtlasAssigneeConfig {
  return resolveTaskAssigneeCore(task) as AtlasAssigneeConfig;
}

export function taskMatchesAssignee(task: AssignmentTask, assigneeKey: AtlasAssigneeKey) {
  return resolveTaskAssignee(task).key === assigneeKey;
}

export function assignedTaskHref(taskId: string, assigneeKey: AtlasAssigneeKey) {
  return assignedTaskHrefCore(taskId, assigneeKey);
}
