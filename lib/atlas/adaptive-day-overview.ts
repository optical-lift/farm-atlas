import type { WorkerHandTask } from "@/lib/atlas-data/worker-hand";
import type { WorkerDayRoutingState, WorkerRoutingMode } from "@/lib/atlas-data/worker-day-routing";

export type AdaptiveDayTask = WorkerHandTask & { reason: string; score: number };
export type AdaptiveDayPlan = {
  now: AdaptiveDayTask[];
  comingUp: AdaptiveDayTask[];
  later: AdaptiveDayTask[];
  waiting: AdaptiveDayTask[];
};

const OUTDOOR_TERMS = ["field row", "barn bed", "berry walk", "main garden", "entry billboard", "curve garden", "follow me", "lilac haven", "hydrangea", "labyrinth", "crescent moon", "u-pick", "upick", "mailbox", "redbud", "orchard", "garden", "mow", "weed", "harvest", "transplant", "sow", "spray", "fishing line"];
const INDOOR_TERMS = ["grow room", "kitchen", "living room", "lounge", "bathroom", "basement", "garage freezer", "coffee bar", "inside", "indoor"];

function textMeta(task: WorkerHandTask, key: string) {
  const value = task.metadata?.[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function numberMeta(task: WorkerHandTask, keys: string[]) {
  for (const key of keys) {
    const value = task.metadata?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function workerHandTaskIsOutdoor(task: WorkerHandTask) {
  const explicit = textMeta(task, "work_environment") || textMeta(task, "environment") || textMeta(task, "work_location_type");
  if (["indoor", "inside", "covered_indoor"].includes(explicit)) return false;
  if (["outdoor", "outside", "field"].includes(explicit)) return true;
  if (task.metadata?.outdoor === true || task.metadata?.outside === true) return true;
  if (task.metadata?.indoor === true || task.metadata?.inside === true) return false;
  const haystack = [task.title, task.taskType, task.actionKey, task.workClass, task.zoneKey, task.zoneLabel].filter(Boolean).join(" ").toLowerCase();
  if (INDOOR_TERMS.some((term) => haystack.includes(term))) return false;
  return OUTDOOR_TERMS.some((term) => haystack.includes(term));
}

function level(value: string) {
  if (["high", "heavy", "hard"].includes(value)) return 3;
  if (["medium", "moderate"].includes(value)) return 2;
  if (["low", "light", "easy"].includes(value)) return 1;
  return 2;
}

function clarity(task: WorkerHandTask) {
  const value = textMeta(task, "completion_clarity");
  if (["high", "clear"].includes(value)) return 3;
  if (["low", "unclear"].includes(value)) return 1;
  return 2;
}

function baseScore(task: WorkerHandTask) {
  let score = task.lane === "overdue" ? 42 : task.lane === "today" ? 34 : 22;
  const priority = task.priority.toLowerCase();
  if (priority === "urgent") score += 24;
  else if (priority === "high") score += 16;
  else if (priority === "low") score -= 5;
  if (task.commitmentKind === "hard_date" || task.commitmentKind === "required") score += 8;
  return score;
}

function modeAdjustment(task: WorkerHandTask, mode: WorkerRoutingMode, recovery: boolean) {
  const activation = level(textMeta(task, "activation_demand"));
  const ambiguity = level(textMeta(task, "ambiguity_load"));
  const setup = level(textMeta(task, "setup_load"));
  const physical = level(textMeta(task, "physical_load") || textMeta(task, "load") || task.workClass?.toLowerCase() || "medium");
  const minutes = numberMeta(task, ["expected_minutes", "estimated_minutes", "duration_minutes", "active_minutes", "expected_active_minutes"]);
  const clear = clarity(task);
  let score = 0;

  if (recovery) {
    score += (4 - activation) * 9 + (4 - ambiguity) * 7 + (4 - setup) * 6 + clear * 6;
    if (physical >= 3) score -= 8;
    if (minutes !== null && minutes <= 15) score += 6;
    return score;
  }

  if (mode === "ready") {
    score += activation * 2 + clear * 2;
  } else if (mode === "keep_moving") {
    score += (4 - ambiguity) * 8 + (4 - setup) * 5 + clear * 5;
    if (physical === 2) score += 5;
    if (activation >= 3) score -= 6;
  } else if (mode === "make_simple") {
    score += (4 - activation) * 9 + (4 - ambiguity) * 8 + (4 - setup) * 7 + clear * 7;
    if (minutes !== null && minutes <= 10) score += 12;
    else if (minutes !== null && minutes <= 25) score += 6;
  } else if (mode === "light_physical") {
    score += (4 - physical) * 13 + clear * 4;
    if (physical >= 3) score -= 22;
  }
  return score;
}

function reasonFor(task: WorkerHandTask, state: WorkerDayRoutingState | null, outdoorEligible: boolean) {
  const minutes = numberMeta(task, ["expected_minutes", "estimated_minutes", "duration_minutes", "active_minutes", "expected_active_minutes"]);
  const activation = level(textMeta(task, "activation_demand"));
  const ambiguity = level(textMeta(task, "ambiguity_load"));
  const physical = level(textMeta(task, "physical_load") || task.workClass?.toLowerCase() || "medium");
  if (workerHandTaskIsOutdoor(task) && !outdoorEligible) return "Outside looks better later";
  if (task.lane === "overdue") return "Overdue — worth moving";
  if (minutes !== null && minutes <= 10) return "Quick win";
  if (state?.recoveryMode === "recovery" && activation <= 1 && ambiguity <= 1) return "Clear, low-thinking work";
  if (state?.routingMode === "keep_moving" && ambiguity <= 1) return "Straightforward work to stay moving";
  if (state?.routingMode === "make_simple" && activation <= 1) return "Good clear start";
  if (state?.routingMode === "light_physical" && physical <= 1) return "Lower physical load";
  if (task.lane === "today") return "Needed today";
  return "Useful next work";
}

export function buildAdaptiveDayPlan(
  tasks: WorkerHandTask[],
  state: WorkerDayRoutingState | null,
  options: { outdoorEligible?: (task: WorkerHandTask) => boolean } = {},
): AdaptiveDayPlan {
  const recovery = state?.recoveryMode === "recovery" && (state?.recoveryMovesRemaining ?? 0) > 0;
  const mode = state?.routingMode ?? "ready";
  const waiting: AdaptiveDayTask[] = [];
  const candidates: AdaptiveDayTask[] = [];

  for (const task of tasks) {
    const outdoorEligible = options.outdoorEligible ? options.outdoorEligible(task) : true;
    const item: AdaptiveDayTask = {
      ...task,
      score: baseScore(task) + modeAdjustment(task, mode, recovery) + (outdoorEligible ? 0 : -90),
      reason: reasonFor(task, state, outdoorEligible),
    };
    if (task.lane === "blocked" || task.status === "blocked") waiting.push(item);
    else candidates.push(item);
  }

  candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  waiting.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return {
    now: candidates.slice(0, 1),
    comingUp: candidates.slice(1, 4),
    later: candidates.slice(4),
    waiting,
  };
}
