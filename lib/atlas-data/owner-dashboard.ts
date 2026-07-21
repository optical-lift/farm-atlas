import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { addDaysIso, centralDateIso } from "@/lib/atlas/date";
import { getFarmOperationalState } from "@/lib/atlas-data/operational-state";
import {
  getTaskSchedule,
  type TaskScheduleProjection,
} from "@/lib/atlas-data/task-schedule";

type ScheduleTask = TaskScheduleProjection["days"][number]["tasks"][number];

export type OwnerAction = {
  id: string | null;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  taskType: string;
  blocker: string | null;
  detail: string | null;
  location: string;
  assignee: string;
  visibilityScope: string;
  totalSteps: number;
  completedSteps: number;
};

export type OwnerBlocker = {
  id: string | null;
  title: string;
  blocker: string;
  location: string;
  dueDate: string | null;
};

export type WorkerExecution = {
  membershipId: string;
  displayName: string;
  workerKey: string | null;
  open: number;
  blocked: number;
  done: number;
  nextTask: OwnerAction | null;
};

export type OwnerDashboardProjection = {
  farm: {
    id: string | null;
    farmKey: string | null;
    name: string;
  };
  generatedForDate: string;
  weekEndDate: string;
  horizonEndDate: string;
  counts: {
    open: number;
    blocked: number;
    overdue: number;
    today: number;
    thisWeek: number;
    later: number;
    farmObjects: number;
    croppedObjects: number;
    criticalObjects: number;
    highRiskObjects: number;
    decisionRequired: number;
    maintenanceDue: number;
  };
  ownerActions: {
    overdue: OwnerAction[];
    today: OwnerAction[];
    thisWeek: OwnerAction[];
    later: OwnerAction[];
    recentlyDone: OwnerAction[];
  };
  farmBlockers: OwnerBlocker[];
  workerExecution: WorkerExecution[];
  upcomingDeadlines: OwnerAction[];
};

function taskLocation(task: ScheduleTask) {
  return task.object.label || task.zone.label || "Elm Farm";
}

function action(task: ScheduleTask): OwnerAction {
  return {
    id: task.taskId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    taskType: task.taskType,
    blocker: task.blocker,
    detail: task.instruction,
    location: taskLocation(task),
    assignee: task.assignee.displayName,
    visibilityScope: task.visibilityScope,
    totalSteps: task.totalSteps,
    completedSteps: task.completedSteps,
  };
}

function taskDateSort(left: ScheduleTask, right: ScheduleTask) {
  const leftDate = left.dueDate ?? "9999-12-31";
  const rightDate = right.dueDate ?? "9999-12-31";
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  return left.title.localeCompare(right.title);
}

function uniqueTasks(tasks: ScheduleTask[]) {
  const byId = new Map<string, ScheduleTask>();
  for (const task of tasks) {
    if (task.taskId && !byId.has(task.taskId)) byId.set(task.taskId, task);
  }
  return Array.from(byId.values());
}

export async function getOwnerDashboard(
  access: AtlasRoleAccess,
): Promise<OwnerDashboardProjection> {
  if (access.membership.role !== "owner") {
    throw new Error("Owner membership required.");
  }

  const today = centralDateIso();
  const weekEnd = addDaysIso(today, 6);
  const horizonEnd = addDaysIso(today, 30);
  const recentStart = addDaysIso(today, -14);

  const [farmState, schedule, recentSchedule] = await Promise.all([
    getFarmOperationalState(access),
    getTaskSchedule(access, {
      startDate: today,
      endDate: horizonEnd,
      includeOverdue: true,
      includeUndated: true,
    }),
    getTaskSchedule(access, {
      startDate: recentStart,
      endDate: today,
      includeOverdue: false,
      includeUndated: false,
    }),
  ]);

  const scheduled = schedule.days.flatMap((day) => day.tasks);
  const carryover = [
    ...schedule.carryover.blocked,
    ...schedule.carryover.overdue,
    ...schedule.carryover.undated,
  ];
  const currentTasks = uniqueTasks([...scheduled, ...carryover]);
  const ownerTasks = currentTasks
    .filter((task) => task.visibilityScope === "owner")
    .sort(taskDateSort);
  const openOwnerTasks = ownerTasks.filter((task) => task.status === "open" || task.status === "blocked");

  const overdue = openOwnerTasks.filter((task) => Boolean(task.dueDate && task.dueDate < today));
  const todayTasks = openOwnerTasks.filter((task) => task.dueDate === today);
  const thisWeek = openOwnerTasks.filter(
    (task) => Boolean(task.dueDate && task.dueDate > today && task.dueDate <= weekEnd),
  );
  const later = openOwnerTasks.filter((task) => !task.dueDate || task.dueDate > weekEnd);
  const recentlyDone = recentSchedule.days
    .flatMap((day) => day.tasks)
    .filter((task) => task.visibilityScope === "owner" && task.status === "done")
    .sort((left, right) => (right.dueDate ?? "").localeCompare(left.dueDate ?? ""))
    .slice(0, 8);

  const blockerRows: OwnerBlocker[] = [];
  for (const task of currentTasks.filter((item) => item.status === "blocked" || item.blocker)) {
    blockerRows.push({
      id: task.taskId,
      title: task.title,
      blocker: task.blocker || "This task is blocked.",
      location: taskLocation(task),
      dueDate: task.dueDate,
    });
  }
  for (const zone of farmState.zones) {
    for (const object of zone.objects) {
      if (!object.nextAction.blocker) continue;
      blockerRows.push({
        id: object.nextAction.taskId,
        title: object.nextAction.label || object.label,
        blocker: object.nextAction.blocker,
        location: `${zone.label} · ${object.label}`,
        dueDate: object.nextAction.dueDate,
      });
    }
  }
  const uniqueBlockers = Array.from(
    new Map(blockerRows.map((item) => [`${item.id ?? item.title}:${item.blocker}`, item])).values(),
  ).slice(0, 10);

  const workers = new Map<string, WorkerExecution & { tasks: ScheduleTask[] }>();
  for (const task of scheduled) {
    const membershipId = task.assignee.membershipId;
    if (!membershipId || task.visibilityScope !== "assigned_worker") continue;
    const current = workers.get(membershipId) ?? {
      membershipId,
      displayName: task.assignee.displayName,
      workerKey: task.assignee.workerKey,
      open: 0,
      blocked: 0,
      done: 0,
      nextTask: null,
      tasks: [],
    };
    current.tasks.push(task);
    if (task.status === "done") current.done += 1;
    else if (task.status === "blocked") current.blocked += 1;
    else current.open += 1;
    workers.set(membershipId, current);
  }
  const workerExecution = Array.from(workers.values())
    .map(({ tasks, ...worker }) => ({
      ...worker,
      nextTask: tasks.filter((task) => task.status !== "done").sort(taskDateSort)[0]
        ? action(tasks.filter((task) => task.status !== "done").sort(taskDateSort)[0])
        : null,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  const upcomingDeadlines = scheduled
    .filter(
      (task) =>
        task.status !== "done" &&
        Boolean(task.dueDate && task.dueDate >= today && task.dueDate <= weekEnd),
    )
    .sort(taskDateSort)
    .slice(0, 12)
    .map(action);

  return {
    farm: farmState.farm,
    generatedForDate: today,
    weekEndDate: weekEnd,
    horizonEndDate: horizonEnd,
    counts: {
      open: openOwnerTasks.length,
      blocked: openOwnerTasks.filter((task) => task.status === "blocked").length,
      overdue: overdue.length,
      today: todayTasks.length,
      thisWeek: thisWeek.length,
      later: later.length,
      farmObjects: farmState.counts.objects,
      croppedObjects: farmState.counts.cropped,
      criticalObjects: farmState.counts.critical,
      highRiskObjects: farmState.counts.high,
      decisionRequired: farmState.counts.decisionRequired,
      maintenanceDue: farmState.counts.maintenanceDue,
    },
    ownerActions: {
      overdue: overdue.map(action),
      today: todayTasks.map(action),
      thisWeek: thisWeek.map(action),
      later: later.map(action),
      recentlyDone: recentlyDone.map(action),
    },
    farmBlockers: uniqueBlockers,
    workerExecution,
    upcomingDeadlines,
  };
}
