const PRIORITY_ORDER = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isChild(task) {
  const metadata = asRecord(task.metadata);
  return Boolean(text(task.parent_task_id) ?? text(metadata.parent_task_id)) || metadata.is_child_task === true;
}

function isOpen(task) {
  return task.status === "open" || task.status === "blocked";
}

function compareTasks(left, right) {
  const leftDue = text(left.due_date) ?? "9999-12-31";
  const rightDue = text(right.due_date) ?? "9999-12-31";
  if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);

  const leftPriority = PRIORITY_ORDER[text(left.priority) ?? "normal"] ?? 9;
  const rightPriority = PRIORITY_ORDER[text(right.priority) ?? "normal"] ?? 9;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  return (text(left.title) ?? "").localeCompare(text(right.title) ?? "");
}

function action(task) {
  return {
    id: text(task.id),
    title: text(task.title) ?? "Untitled task",
    status: text(task.status) ?? "open",
    priority: text(task.priority) ?? "normal",
    dueDate: text(task.due_date),
    taskType: text(task.task_type) ?? "general",
    visibilityScope: text(task.visibility_scope) ?? "management",
    assignedMembershipId: text(task.assigned_membership_id),
    blocker: text(task.blocker_text),
    detail: text(task.note) ?? text(task.unlock_text),
  };
}

export function buildManagerDashboardProjection({ farm, tasks, todayIso }) {
  const farmRow = asRecord(farm);
  const taskRows = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => asRecord(task).id && !isChild(task));

  const openRows = taskRows.filter(isOpen).sort(compareTasks);
  const blocked = openRows.filter((task) => task.status === "blocked").map(action);
  const overdue = openRows
    .filter((task) => task.due_date && task.due_date < todayIso)
    .map(action);
  const today = openRows.filter((task) => task.due_date === todayIso).map(action);
  const workerQueue = openRows
    .filter((task) => task.visibility_scope === "assigned_worker")
    .map(action);
  const unassignedWorker = workerQueue.filter((task) => !task.assignedMembershipId);
  const managementQueue = openRows
    .filter((task) => task.visibility_scope === "management" || task.visibility_scope === "farm_shared")
    .map(action);

  return {
    farm: {
      id: text(farmRow.id),
      farmKey: text(farmRow.stable_key),
      name: text(farmRow.name) ?? "Farm",
      status: text(farmRow.status) ?? "active",
    },
    generatedForDate: todayIso,
    counts: {
      open: openRows.length,
      blocked: blocked.length,
      overdue: overdue.length,
      today: today.length,
      workerQueue: workerQueue.length,
      unassignedWorker: unassignedWorker.length,
      managementQueue: managementQueue.length,
    },
    blocked,
    overdue,
    today,
    workerQueue,
    unassignedWorker,
    managementQueue,
  };
}
