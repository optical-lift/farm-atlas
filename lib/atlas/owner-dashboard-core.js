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

function numberValue(value, fallback = 999) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function booleanValue(value) {
  return value === true || value === "true";
}

function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function taskParentId(task) {
  return text(task.parent_task_id) ?? text(asRecord(task.metadata).parent_task_id);
}

function isChildTask(task) {
  return Boolean(taskParentId(task)) || booleanValue(asRecord(task.metadata).is_child_task);
}

function isCompleted(task) {
  return task.status === "done";
}

function isOpen(task) {
  return task.status === "open" || task.status === "blocked";
}

function taskSort(left, right) {
  const leftDue = text(left.due_date) ?? "9999-12-31";
  const rightDue = text(right.due_date) ?? "9999-12-31";
  if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);

  const leftPriority = PRIORITY_ORDER[text(left.priority) ?? "normal"] ?? 9;
  const rightPriority = PRIORITY_ORDER[text(right.priority) ?? "normal"] ?? 9;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const leftOrder = numberValue(asRecord(left.metadata).day_order);
  const rightOrder = numberValue(asRecord(right.metadata).day_order);
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;

  return (text(left.title) ?? "").localeCompare(text(right.title) ?? "");
}

function completedSort(left, right) {
  const leftDate = text(left.completed_at) ?? text(left.updated_at) ?? "";
  const rightDate = text(right.completed_at) ?? text(right.updated_at) ?? "";
  return rightDate.localeCompare(leftDate);
}

function taskAction(task, childRows) {
  const children = Array.isArray(childRows) ? childRows : [];
  const completedSteps = children.filter(isCompleted).length;
  const metadata = asRecord(task.metadata);

  return {
    id: text(task.id),
    title: text(task.title) ?? "Untitled task",
    status: text(task.status) ?? "open",
    priority: text(task.priority) ?? "normal",
    dueDate: text(task.due_date),
    taskType: text(task.task_type) ?? "general",
    blocker: text(task.blocker_text),
    detail: text(task.note) ?? text(task.unlock_text),
    totalSteps: children.length,
    completedSteps,
    workRoute: text(metadata.work_route),
  };
}

export function buildOwnerDashboardProjection({ farm, tasks, todayIso }) {
  const farmRow = asRecord(farm);
  const taskRows = (Array.isArray(tasks) ? tasks : []).filter((task) => asRecord(task).id);
  const weekEnd = addDaysIso(todayIso, 6);

  const childrenByParent = new Map();
  for (const task of taskRows.filter(isChildTask)) {
    const parentId = taskParentId(task);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(task);
    childrenByParent.set(parentId, children);
  }

  const parents = taskRows.filter((task) => !isChildTask(task));
  const openParents = parents.filter(isOpen).sort(taskSort);
  const completedParents = parents.filter(isCompleted).sort(completedSort);

  const mapAction = (task) => taskAction(task, childrenByParent.get(task.id));
  const overdue = openParents.filter((task) => task.due_date && task.due_date < todayIso).map(mapAction);
  const today = openParents.filter((task) => task.due_date === todayIso).map(mapAction);
  const thisWeek = openParents
    .filter((task) => task.due_date && task.due_date > todayIso && task.due_date <= weekEnd)
    .map(mapAction);
  const later = openParents
    .filter((task) => !task.due_date || task.due_date > weekEnd)
    .map(mapAction);
  const recentlyDone = completedParents.slice(0, 8).map(mapAction);

  return {
    farm: {
      id: text(farmRow.id),
      farmKey: text(farmRow.stable_key),
      name: text(farmRow.name) ?? "Farm",
      status: text(farmRow.status) ?? "active",
    },
    generatedForDate: todayIso,
    weekEndDate: weekEnd,
    counts: {
      open: openParents.length,
      blocked: openParents.filter((task) => task.status === "blocked").length,
      overdue: overdue.length,
      today: today.length,
      thisWeek: thisWeek.length,
      later: later.length,
    },
    ownerActions: {
      overdue,
      today,
      thisWeek,
      later,
      recentlyDone,
    },
    farmBlockers: [],
    workerExecution: [],
    upcomingDeadlines: [],
  };
}
