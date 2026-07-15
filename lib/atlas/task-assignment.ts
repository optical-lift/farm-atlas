export type AtlasAssigneeKey = "owner" | "marshall" | "kids" | "farm_team" | "anna";

export type AtlasAssigneeConfig = {
  key: AtlasAssigneeKey;
  label: string;
  listPath: string;
  secondaryAction: "tomorrow" | "unfinished";
};

export const ATLAS_ASSIGNEES: Record<AtlasAssigneeKey, AtlasAssigneeConfig> = {
  owner: {
    key: "owner",
    label: "Owner",
    listPath: "/owner",
    secondaryAction: "tomorrow",
  },
  marshall: {
    key: "marshall",
    label: "Marshall",
    listPath: "/marshall",
    secondaryAction: "tomorrow",
  },
  kids: {
    key: "kids",
    label: "Kids",
    listPath: "/children",
    secondaryAction: "unfinished",
  },
  farm_team: {
    key: "farm_team",
    label: "Farm Team",
    listPath: "/",
    secondaryAction: "unfinished",
  },
  anna: {
    key: "anna",
    label: "Anna",
    listPath: "/",
    secondaryAction: "unfinished",
  },
};

type AssignmentTask = {
  metadata?: Record<string, unknown> | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function boolish(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === 1;
}

function normalizeAssignee(value: string): AtlasAssigneeKey | null {
  if (value === "owner") return "owner";
  if (value === "marshall") return "marshall";
  if (value === "kids" || value === "children") return "kids";
  if (value === "anna") return "anna";
  if (value === "farm_team" || value === "farm team" || value === "team") return "farm_team";
  return null;
}

export function resolveTaskAssignee(task: AssignmentTask): AtlasAssigneeConfig {
  const metadata = task.metadata ?? {};

  const explicit = normalizeAssignee(text(metadata.assignee_key));
  if (explicit) return ATLAS_ASSIGNEES[explicit];

  const assignedTo = normalizeAssignee(text(metadata.assigned_to));
  if (assignedTo) return ATLAS_ASSIGNEES[assignedTo];

  const workRoute = normalizeAssignee(text(metadata.work_route));
  if (workRoute) return ATLAS_ASSIGNEES[workRoute];

  const collectionZone = normalizeAssignee(text(metadata.collection_zone));
  if (collectionZone) return ATLAS_ASSIGNEES[collectionZone];

  if (boolish(metadata.owner_task)) return ATLAS_ASSIGNEES.owner;
  if (boolish(metadata.marshall_task)) return ATLAS_ASSIGNEES.marshall;
  if (boolish(metadata.children_task)) return ATLAS_ASSIGNEES.kids;
  if (boolish(metadata.anna_task)) return ATLAS_ASSIGNEES.anna;

  return ATLAS_ASSIGNEES.farm_team;
}
