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

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

function booleanValue(value) {
  return value === true || value === "true";
}

function validIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateRange(startDate, endDate) {
  if (!validIsoDate(startDate) || !validIsoDate(endDate) || endDate < startDate) {
    return [];
  }

  const dates = [];
  for (let date = startDate; date <= endDate; date = addDaysIso(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function normalizeLane(value, status, dueDate, startDate, countsForWindow) {
  const candidate = text(value);
  if (["completed", "blocked", "overdue", "undated", "today", "scheduled"].includes(candidate)) {
    return candidate;
  }
  if (status === "done") return "completed";
  if (status === "blocked") return "blocked";
  if (!dueDate) return "undated";
  if (!countsForWindow && dueDate < startDate) return "overdue";
  return startDate === dueDate ? "today" : "scheduled";
}

function normalizeTask(row, startDate) {
  const source = asRecord(row);
  const status = text(source.status) ?? "open";
  const dueDate = text(source.due_date);
  const countsForWindow = booleanValue(source.counts_for_window);

  return {
    taskId: text(source.task_id),
    title: text(source.title) ?? "Untitled task",
    taskType: text(source.task_type) ?? "general",
    status,
    priority: text(source.priority) ?? "normal",
    dueDate,
    instruction: text(source.instruction),
    blocker: text(source.blocker_text),
    zone: {
      id: text(source.zone_id),
      key: text(source.zone_key),
      label: text(source.zone_label),
    },
    object: {
      id: text(source.object_id),
      key: text(source.object_key),
      label: text(source.object_label),
    },
    assignee: {
      membershipId: text(source.assigned_membership_id),
      displayName: text(source.assigned_display_name) ?? "Farm Team",
      workerKey: text(source.assigned_worker_key),
    },
    visibilityScope: text(source.visibility_scope) ?? "system_internal",
    lane: normalizeLane(source.schedule_lane, status, dueDate, startDate, countsForWindow),
    totalSteps: numberValue(source.total_steps),
    completedSteps: numberValue(source.completed_steps),
    canAct: booleanValue(source.can_act),
    countsForWindow,
  };
}

function taskSort(left, right) {
  if (left.status !== right.status) {
    if (left.status === "blocked") return -1;
    if (right.status === "blocked") return 1;
    if (left.status === "done") return 1;
    if (right.status === "done") return -1;
  }

  const leftPriority = PRIORITY_ORDER[left.priority] ?? 9;
  const rightPriority = PRIORITY_ORDER[right.priority] ?? 9;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return left.title.localeCompare(right.title);
}

function progressFor(tasks) {
  const counted = tasks.filter((task) => task.countsForWindow);
  const total = counted.length;
  const completed = counted.filter((task) => task.status === "done").length;
  const blocked = counted.filter((task) => task.status === "blocked").length;
  const open = total - completed;

  return {
    total,
    completed,
    open,
    blocked,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export function buildTaskScheduleProjection({ rows, startDate, endDate }) {
  const dates = dateRange(startDate, endDate);
  const tasks = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeTask(row, startDate))
    .filter((task) => task.taskId)
    .sort((left, right) => {
      const leftDate = left.dueDate ?? "9999-12-31";
      const rightDate = right.dueDate ?? "9999-12-31";
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return taskSort(left, right);
    });

  const tasksByDate = new Map(dates.map((date) => [date, []]));
  const carryoverBlocked = [];
  const carryoverOverdue = [];
  const undated = [];

  for (const task of tasks) {
    if (task.countsForWindow && task.dueDate && tasksByDate.has(task.dueDate)) {
      tasksByDate.get(task.dueDate).push(task);
      continue;
    }

    if (task.lane === "blocked") {
      carryoverBlocked.push(task);
    } else if (task.lane === "overdue") {
      carryoverOverdue.push(task);
    } else if (task.lane === "undated") {
      undated.push(task);
    }
  }

  const days = dates.map((date) => {
    const dayTasks = tasksByDate.get(date).sort(taskSort);
    return {
      date,
      progress: progressFor(dayTasks),
      tasks: dayTasks,
    };
  });

  return {
    startDate,
    endDate,
    progress: progressFor(tasks),
    counts: {
      returned: tasks.length,
      scheduled: tasks.filter((task) => task.countsForWindow).length,
      carryoverBlocked: carryoverBlocked.length,
      carryoverOverdue: carryoverOverdue.length,
      undated: undated.length,
    },
    carryover: {
      blocked: carryoverBlocked.sort(taskSort),
      overdue: carryoverOverdue.sort(taskSort),
      undated: undated.sort(taskSort),
    },
    days,
  };
}

export function addScheduleDays(dateIso, days) {
  if (!validIsoDate(dateIso) || !Number.isInteger(days)) {
    throw new Error("Valid ISO date and whole-day offset required.");
  }
  return addDaysIso(dateIso, days);
}
