import "server-only";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type {
  AtlasUniversalHomeModel,
  AtlasUniversalProjectTask,
} from "@/lib/atlas/universal-home";

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function projectTaskAsCard(task: AtlasUniversalProjectTask): AtlasTaskCard {
  const detail = task.blockerText
    || task.note
    || `Open ${task.projectTitle} to review this work.`;
  const scopeLabel = task.farmName || "Feast Guild";
  const completedAt = task.completedAt || task.updatedAt;

  return {
    farm_key: task.farmKey || "feast_guild",
    task_id: task.taskId,
    title: task.title,
    task_type: "project_task",
    status: task.status,
    priority: task.priority,
    due_date: task.dueDate,
    unlock_text: null,
    blocker_text: task.blockerText,
    note: task.note,
    generated_from: "project",
    generated_from_id: task.projectId,
    action_key: "project",
    work_class: "project",
    parent_task_id: null,
    task_series_key: null,
    engine_instance_key: null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    metadata: {
      task_scope: "project",
      project_task: true,
      project_id: task.projectId,
      project_key: task.projectKey,
      project_title: task.projectTitle,
      workstream: task.workstream,
      origin_kind: task.originKind,
      assigned_to_viewer: task.assignedToViewer,
      created_by_viewer: task.createdByViewer,
      completed_at: task.completedAt,
      scope_label: scopeLabel,
      display_action: titleCase(task.workstream || "Project work"),
      display_title: task.title,
      display_subject: task.title,
      display_location: task.projectTitle,
      display_detail: detail,
      collection_zone: task.projectTitle,
      work_rhythm: "Project Work",
      work_route: "venue",
      quick_complete_allowed: false,
      structured_result_required: true,
    },
    zone_id: null,
    zone_key: null,
    zone_label: null,
    task_logs: [],
    task_outcomes: task.status === "done" ? [{
      event_id: `project-completion:${task.taskId}`,
      outcome: "done",
      lane_key: "project",
      work_key: "project",
      blocker_reason: null,
      note: task.note,
      created_at: completedAt,
    }] : [],
    task_transitions: [],
    objects: [],
    resource_requirements: [],
    action_templates: [],
  };
}

function farmTaskWithScope(
  card: AtlasTaskCard,
  farm: AtlasUniversalHomeModel["farms"][number],
): AtlasTaskCard {
  return {
    ...card,
    metadata: {
      ...(card.metadata ?? {}),
      task_scope: "farm_operation",
      farm_id: farm.farmId,
      farm_name: farm.farmName,
      scope_label: farm.farmName,
    },
  };
}

export function atlasUniversalTaskCards(home: AtlasUniversalHomeModel): AtlasTaskCard[] {
  const cards = [
    ...home.farms.flatMap((farm) => farm.taskCards.map((card) => farmTaskWithScope(card, farm))),
    ...home.projectTasks.map(projectTaskAsCard),
  ];
  const seen = new Set<string>();

  return cards
    .sort((left, right) => (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31")
      || left.created_at.localeCompare(right.created_at)
      || left.task_id.localeCompare(right.task_id))
    .filter((card) => {
      if (seen.has(card.task_id)) return false;
      seen.add(card.task_id);
      return true;
    });
}

export function atlasUniversalPortalLabel(home: AtlasUniversalHomeModel) {
  const organizationMembership = home.viewer.organizationMemberships.find(
    (membership) => membership.organizationId === home.viewer.activeOrganizationId,
  ) ?? home.viewer.organizationMemberships[0] ?? null;
  const organizationPortal = Boolean(
    organizationMembership
      && (organizationMembership.role === "owner" || home.viewer.farmMemberships.length === 0),
  );

  if (organizationPortal) {
    return home.organizationHome?.organization.name
      || organizationMembership?.organizationName
      || "Feast Guild";
  }

  return home.activeFarm?.farmName || home.title || "Atlas";
}
