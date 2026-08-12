import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

export type AtlasDayRouteState = "current" | "future" | "blocked" | "care";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown) {
  return text(value).toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function truthy(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === "1" || value === 1;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function words(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string) {
  return words(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metadataString(task: AtlasTaskCard, key: string) {
  return text(task.metadata?.[key]);
}

function isAnnaErrandTask(task: AtlasTaskCard) {
  const metadata = task.metadata ?? {};
  const annaAssigned = truthy(metadata.anna_task)
    || normalized(metadata.assignee_key) === "anna"
    || normalized(metadata.executor_worker_key) === "anna"
    || normalized(metadata.assigned_to) === "anna";
  if (!annaAssigned) return false;

  const action = normalized(task.action_key);
  const workRoute = normalized(metadata.work_route);
  const taskType = normalized(task.task_type);
  const displayAction = normalized(metadata.display_action);

  return [action, workRoute, taskType, displayAction]
    .some((value) => ["buy", "purchase", "errand", "farm_errand"].includes(value));
}

const ACTION_FAMILIES: Record<string, string> = {
  sow: "Sow",
  sowing: "Sow",
  seed: "Sow",
  seeding: "Sow",
  transplant: "Transplant",
  transplanting: "Transplant",
  plant: "Plant",
  planting: "Plant",
  weed: "Weed",
  weeding: "Weed",
  mow: "Mow",
  mowing: "Mow",
  water: "Water",
  watering: "Water",
  spray: "Spray",
  spraying: "Spray",
  respray: "Spray",
  harvest: "Harvest",
  postharvest: "Postharvest",
  propagation: "Propagation",
  propagate: "Propagation",
  check: "Check",
  verify: "Check",
  inspect: "Check",
  germination_check: "Germination check",
  call: "Call",
  move: "Move",
  deliver: "Deliver",
  delivery: "Deliver",
  repair: "Repair",
  install: "Install",
  finish: "Finish",
  paint: "Paint",
  stain: "Stain",
  clean: "Clean",
  prep: "Prepare",
  prepare: "Prepare",
  build: "Build",
  buy: "Errand",
  purchase: "Errand",
  errand: "Errand",
  farm_errand: "Errand",
};

const GENERIC_ACTION_KEYS = new Set([
  "",
  "owner",
  "marshall",
  "venue",
  "work",
  "standard",
  "manual",
  "required",
]);

function canonicalActionKey(task: AtlasTaskCard) {
  if (isAnnaErrandTask(task)) return "errand";

  const actionKey = normalized(task.action_key);
  if (actionKey && !GENERIC_ACTION_KEYS.has(actionKey)) return actionKey;

  const displayAction = normalized(task.metadata?.display_action);
  if (displayAction) return displayAction;

  const workRoute = normalized(task.metadata?.work_route);
  if (workRoute && !GENERIC_ACTION_KEYS.has(workRoute)) return workRoute;

  return normalized(task.task_type) || actionKey || workRoute;
}

function explicitFamily(task: AtlasTaskCard) {
  return metadataString(task, "display_family")
    || metadataString(task, "work_category_label");
}

/**
 * The day family is presentation of stored operational fields. It must never be
 * guessed from prose in a task title: "cut trim" is venue finish work, while
 * "cut sunflowers" may be harvest work, and the title alone cannot decide.
 */
export function atlasDayTaskFamily(task: AtlasTaskCard) {
  if (isAnnaErrandTask(task)) return "Errand";

  const category = explicitFamily(task);
  if (category) return category;

  const operationClass = normalized(task.operation_class ?? task.metadata?.operation_class);
  if (operationClass === "inspect_assess") return "Check";

  const actionKey = canonicalActionKey(task);
  const mappedAction = ACTION_FAMILIES[actionKey];
  if (mappedAction) return mappedAction;

  if (GENERIC_ACTION_KEYS.has(actionKey)) {
    const displayAction = metadataString(task, "display_action");
    if (displayAction) return displayAction;
  }

  const workClass = text(task.work_class || task.metadata?.work_class);
  if (workClass && !GENERIC_ACTION_KEYS.has(normalized(workClass))) return titleCase(workClass);

  const rhythm = metadataString(task, "work_rhythm");
  if (rhythm && !["owner work", "marshall work", "farm work"].includes(rhythm.toLowerCase())) return rhythm;

  const displayAction = metadataString(task, "display_action");
  if (displayAction) return displayAction;

  return titleCase(task.task_type || task.action_key || "Work");
}

/**
 * Similar work partners from canonical operational fields, not title matching.
 * A rare task may provide an explicit partner key; otherwise its Day family is
 * the stable grouping contract. This lets an overdue respray travel with the
 * day's spray work without changing either task's due date or historical truth.
 */
export function atlasDayTaskPartnerKey(task: AtlasTaskCard) {
  if (isAnnaErrandTask(task)) return "anna_errands";

  const explicit = metadataString(task, "work_partner_key")
    || metadataString(task, "task_family_key");
  return normalized(explicit || atlasDayTaskFamily(task));
}

export function atlasDayIsCarePulse(task: AtlasTaskCard) {
  const action = canonicalActionKey(task);
  const taskType = normalized(task.task_type);
  const rhythm = normalized(task.metadata?.work_rhythm);

  return ["water", "watering", "water_check", "grow_room_round", "grow_room_care", "farm_care", "scout"].includes(action)
    || ["water", "watering", "water_check", "grow_room_care", "farm_care", "scouting"].includes(taskType)
    || ["grow_room_care", "daily_care", "watering"].includes(rhythm);
}

export function atlasDayRouteState(task: AtlasTaskCard, currentTaskId: string | null): AtlasDayRouteState {
  if (task.status === "blocked") return "blocked";
  if (task.task_id === currentTaskId) return "current";
  if (atlasDayIsCarePulse(task)) return "care";
  return "future";
}

export function atlasDayTaskCues(task: AtlasTaskCard) {
  const metadata = task.metadata ?? {};
  const cues: string[] = [];
  const add = (value: string) => {
    const clean = value.trim();
    if (!clean || cues.some((cue) => cue.toLowerCase() === clean.toLowerCase())) return;
    cues.push(clean);
  };

  const scheduledAfter = numberValue(metadata.release_queue_scheduled_after_count);
  if (canonicalActionKey(task) === "weed" && scheduledAfter && scheduledAfter > 0) {
    add(`${scheduledAfter} ${scheduledAfter === 1 ? "weed job" : "weed jobs"} scheduled later`);
  }

  const unlocksTask = metadataString(task, "unlocks_task_label");
  if (unlocksTask && metadataString(task, "unlocks_queue_key")) add(`Next: ${unlocksTask}`);

  // Mowing preparation is procedural truth of mowing, not a second weekly task.
  // Keeping it as a cue on the mowing card means it travels whenever mowing moves.
  if (canonicalActionKey(task) === "mow") add("First: pick up sticks + move hoses");

  const equipment = text(metadata.equipment_label) || text(metadata.equipment_group);
  if (equipment) add(titleCase(equipment));

  const mowerSetting = numberValue(metadata.mower_setting ?? metadata.target_cut_height_inches);
  if (mowerSetting && equipment.toLowerCase().includes("mower")) add(`Setting ${mowerSetting}`);

  const workClass = text(task.work_class || metadata.work_class);
  if (workClass && !["standard", "manual", "required", "light"].includes(workClass.toLowerCase())) add(titleCase(workClass));

  const resource = task.resource_requirements?.find((item) => item.resource_label && item.status !== "unavailable")?.resource_label;
  if (resource) add(resource);

  return cues.slice(0, 3);
}

export function atlasDayCurrentTask(tasks: AtlasTaskCard[]) {
  return tasks.find((task) => task.status === "open") ?? tasks.find((task) => task.status === "blocked") ?? null;
}
