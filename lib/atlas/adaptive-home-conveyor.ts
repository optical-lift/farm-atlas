import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { AtlasUniversalHomeModel, AtlasUniversalMove } from "@/lib/atlas/universal-home";
import type { WorkerDayRoutingState } from "@/lib/atlas-data/worker-day-routing";
import { buildAdaptiveDayPlan, type AdaptiveDayTask } from "@/lib/atlas/adaptive-day-overview";

function taskIdFromMove(move: AtlasUniversalMove) {
  if (move.kind !== "farm_task" || !move.key.startsWith("farm-task:")) return null;
  return move.key.split(":").at(-1) ?? null;
}

function textMeta(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericMeta(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function workerTaskFromCard(task: AtlasTaskCard, move: AtlasUniversalMove, today: string): AdaptiveDayTask {
  const lane = move.state === "blocked"
    ? "blocked"
    : task.due_date && task.due_date < today
      ? "overdue"
      : task.due_date === today
        ? "today"
        : "undated";
  return {
    taskId: task.task_id,
    title: task.title,
    taskType: task.task_type,
    status: task.status,
    priority: task.priority,
    dueDate: task.due_date,
    instruction: task.note ?? task.unlock_text ?? null,
    blocker: task.blocker_text ?? null,
    zoneId: task.zone_id ?? null,
    zoneKey: task.zone_key ?? null,
    zoneLabel: task.zone_label ?? null,
    assignedMembershipId: textMeta(task, "executor_membership_id"),
    visibilityScope: textMeta(task, "visibility_scope") ?? "assigned_worker",
    lane,
    totalSteps: 0,
    completedSteps: 0,
    canAct: true,
    metadata: task.metadata ?? {},
    workClass: task.work_class ?? null,
    actionKey: task.action_key ?? null,
    commitmentKind: textMeta(task, "commitment_kind"),
    effortUnits: numericMeta(task, "effort_units"),
    taskScope: textMeta(task, "task_scope"),
    reason: "",
    score: 0,
  };
}

export function adaptiveHomeConveyorMoves(
  home: AtlasUniversalHomeModel,
  state: WorkerDayRoutingState | null,
  options: { outdoorEligible?: (task: AtlasTaskCard) => boolean } = {},
) {
  const taskById = new Map<string, AtlasTaskCard>();
  home.farms.forEach((farm) => farm.taskCards.forEach((task) => taskById.set(task.task_id, task)));

  const taskMoveById = new Map<string, AtlasUniversalMove>();
  const taskRows: AdaptiveDayTask[] = [];
  const nonTaskMoves: AtlasUniversalMove[] = [];

  for (const move of home.moves) {
    const taskId = taskIdFromMove(move);
    if (!taskId) {
      nonTaskMoves.push(move);
      continue;
    }
    const card = taskById.get(taskId);
    if (!card) {
      nonTaskMoves.push(move);
      continue;
    }
    taskMoveById.set(taskId, move);
    taskRows.push(workerTaskFromCard(card, move, home.window.doneDate));
  }

  const plan = buildAdaptiveDayPlan(taskRows, state, {
    outdoorEligible: (workerTask) => {
      const card = workerTask.taskId ? taskById.get(workerTask.taskId) : null;
      return card ? (options.outdoorEligible?.(card) ?? true) : true;
    },
  });

  const ordered = [...plan.now, ...plan.comingUp, ...plan.later, ...plan.waiting]
    .map((task) => task.taskId ? taskMoveById.get(task.taskId) : null)
    .filter((move): move is AtlasUniversalMove => Boolean(move));

  return [...ordered, ...nonTaskMoves];
}
