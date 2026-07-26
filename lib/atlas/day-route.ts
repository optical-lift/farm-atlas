import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

export type AtlasDayRouteState = "current" | "future" | "blocked" | "care";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function taskSearchText(task: AtlasTaskCard) {
  return `${task.action_key ?? ""} ${task.task_type ?? ""} ${task.work_class ?? ""} ${task.title ?? ""}`.toLowerCase();
}

export function atlasDayTaskFamily(task: AtlasTaskCard) {
  const value = taskSearchText(task);

  if (value.includes("thin")) return "Thin";
  if (value.includes("weed")) return "Weed";
  if (value.includes("transplant") || value.includes("plant out") || value.includes("plant_")) return "Transplant";
  if (value.includes("sow") || value.includes("seed")) return "Sow";
  if (value.includes("harvest") || value.includes("cut") || value.includes("bundle")) return "Harvest";
  if (value.includes("mow")) return "Mow";
  if (value.includes("water") || value.includes("grow_room_care") || value.includes("farm care")) return "Care";
  if (value.includes("check") || value.includes("inspect") || value.includes("germin")) return "Check";
  if (value.includes("paint") || value.includes("clean") || value.includes("venue") || value.includes("reset")) return "Venue";
  if (value.includes("repair") || value.includes("fix")) return "Repair";
  if (value.includes("call") || value.includes("pickup") || value.includes("pick up") || value.includes("errand") || value.includes("buy")) return "Errand";
  if (value.includes("deliver") || value.includes("network")) return "Deliver";

  return titleCase(task.action_key || task.task_type || "Work");
}

export function atlasDayIsCarePulse(task: AtlasTaskCard) {
  const value = taskSearchText(task);
  return value.includes("grow_room_care") || value.includes("water") || value.includes("scout") || value.includes("daily care");
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

  const estimatedMinutes = numberValue(metadata.estimated_minutes ?? metadata.duration_minutes);
  if (estimatedMinutes) add(`${Math.round(estimatedMinutes)} min`);

  const equipment = text(metadata.equipment_label) || text(metadata.equipment_group);
  if (equipment) add(titleCase(equipment));

  const mowerSetting = numberValue(metadata.mower_setting ?? metadata.target_cut_height_inches);
  if (mowerSetting && equipment.toLowerCase().includes("mower")) add(`Setting ${mowerSetting}`);

  const workClass = text(task.work_class || metadata.work_class);
  if (workClass && !["standard", "manual", "required"].includes(workClass.toLowerCase())) add(titleCase(workClass));

  const resource = task.resource_requirements?.find((item) => item.resource_label && item.status !== "unavailable")?.resource_label;
  if (resource) add(resource);

  return cues.slice(0, 3);
}

export function atlasDayCurrentTask(tasks: AtlasTaskCard[]) {
  return tasks.find((task) => task.status === "open") ?? tasks.find((task) => task.status === "blocked") ?? null;
}
