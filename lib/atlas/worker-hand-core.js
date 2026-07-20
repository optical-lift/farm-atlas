function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function task(value) {
  const row = asRecord(value);
  return {
    taskId: text(row.task_id),
    title: text(row.title) ?? "Untitled task",
    taskType: text(row.task_type) ?? "general",
    status: text(row.status) ?? "open",
    priority: text(row.priority) ?? "normal",
    dueDate: text(row.due_date),
    instruction: text(row.instruction),
    blocker: text(row.blocker_text),
    zoneId: text(row.zone_id),
    zoneKey: text(row.zone_key),
    zoneLabel: text(row.zone_label),
    assignedMembershipId: text(row.assigned_membership_id),
    visibilityScope: text(row.visibility_scope) ?? "assigned_worker",
    lane: text(row.task_lane) ?? "undated",
    totalSteps: numeric(row.total_steps),
    completedSteps: numeric(row.completed_steps),
    canAct: row.can_act === true,
  };
}

export function buildWorkerHandProjection({ context, tasks, forDate }) {
  const contextRow = asRecord(context);
  const taskRows = (Array.isArray(tasks) ? tasks : []).map(task);
  const workerMembershipId = text(contextRow.worker_membership_id);

  const lanes = {
    blocked: taskRows.filter((row) => row.lane === "blocked"),
    overdue: taskRows.filter((row) => row.lane === "overdue"),
    today: taskRows.filter((row) => row.lane === "today"),
    undated: taskRows.filter((row) => row.lane === "undated"),
  };

  return {
    farm: {
      id: text(contextRow.farm_id),
      name: text(contextRow.farm_name) ?? "Farm",
    },
    forDate,
    viewerRole: text(contextRow.viewer_role),
    worker: workerMembershipId
      ? {
          membershipId: workerMembershipId,
          displayName: text(contextRow.worker_display_name) ?? "Farm Hand",
          workerKey: text(contextRow.worker_key),
        }
      : null,
    canAct: contextRow.can_act === true,
    unassignedWorkerTaskCount: numeric(contextRow.unassigned_worker_task_count),
    counts: {
      total: taskRows.length,
      blocked: lanes.blocked.length,
      overdue: lanes.overdue.length,
      today: lanes.today.length,
      undated: lanes.undated.length,
    },
    lanes,
  };
}
