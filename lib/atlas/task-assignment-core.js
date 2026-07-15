export const ATLAS_ASSIGNEES_CORE = {
  owner: { key: "owner", label: "Owner", listPath: "/owner", secondaryAction: "tomorrow" },
  marshall: { key: "marshall", label: "Marshall", listPath: "/marshall", secondaryAction: "tomorrow" },
  kids: { key: "kids", label: "Kids", listPath: "/children", secondaryAction: "unfinished" },
  farm_team: { key: "farm_team", label: "Farm Team", listPath: "/", secondaryAction: "unfinished" },
  anna: { key: "anna", label: "Anna", listPath: "/", secondaryAction: "unfinished" },
};

function text(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function boolish(value) {
  return value === true || value === "true" || value === "yes" || value === 1;
}

function normalizeAssignee(value) {
  if (value === "owner") return "owner";
  if (value === "marshall") return "marshall";
  if (value === "kids" || value === "children") return "kids";
  if (value === "anna") return "anna";
  if (value === "farm_team" || value === "farm team" || value === "team") return "farm_team";
  return null;
}

export function resolveTaskAssigneeCore(task) {
  const metadata = task?.metadata ?? {};
  const explicit = normalizeAssignee(text(metadata.assignee_key));
  if (explicit) return ATLAS_ASSIGNEES_CORE[explicit];
  if (boolish(metadata.owner_task)) return ATLAS_ASSIGNEES_CORE.owner;
  if (boolish(metadata.marshall_task)) return ATLAS_ASSIGNEES_CORE.marshall;
  if (boolish(metadata.children_task) || boolish(metadata.kid_chore)) return ATLAS_ASSIGNEES_CORE.kids;
  if (boolish(metadata.anna_task)) return ATLAS_ASSIGNEES_CORE.anna;
  const assignedTo = normalizeAssignee(text(metadata.assigned_to));
  if (assignedTo) return ATLAS_ASSIGNEES_CORE[assignedTo];
  const workRoute = normalizeAssignee(text(metadata.work_route));
  if (workRoute) return ATLAS_ASSIGNEES_CORE[workRoute];
  const collectionZone = normalizeAssignee(text(metadata.collection_zone));
  if (collectionZone) return ATLAS_ASSIGNEES_CORE[collectionZone];
  return ATLAS_ASSIGNEES_CORE.farm_team;
}

export function assignedTaskHrefCore(taskId, assigneeKey) {
  const assignee = ATLAS_ASSIGNEES_CORE[assigneeKey] ?? ATLAS_ASSIGNEES_CORE.farm_team;
  return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(assignee.listPath)}`;
}
