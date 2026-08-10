import type { AtlasTaskCard, AtlasTaskCardObject } from "@/lib/atlas/task-cards-client";
import { atlasMetaString, atlasRouteKeyForTask, atlasTaskDisplay, atlasText, type AtlasWorkRouteKey } from "@/lib/atlas/task-display";

export type TaskConditionRailModel = {
  label: string;
  points: [string, string, string];
  currentIndex: 0 | 1 | 2;
  targetIndex: 0 | 1 | 2;
  meaningful: boolean;
};

type ConditionTemplate = { label: string; points: [string, string, string]; currentIndex: 0 | 1 | 2; targetIndex: 0 | 1 | 2 };

const CONDITION_TEMPLATES: Record<AtlasWorkRouteKey, ConditionTemplate> = {
  weed: { label: "Condition", points: ["Weeds present", "Row readable", "Row clear"], currentIndex: 0, targetIndex: 2 },
  plant: { label: "Site state", points: ["Site ready", "Planted", "Establishment check"], currentIndex: 0, targetIndex: 1 },
  mow: { label: "Route condition", points: ["Long growth", "Acceptable", "Maintained"], currentIndex: 0, targetIndex: 2 },
  seed: { label: "Bed state", points: ["Prepared", "Sown", "Germination watch"], currentIndex: 0, targetIndex: 1 },
  crop_cycle: { label: "Crop state", points: ["Signal due", "Observed", "Next gate ready"], currentIndex: 0, targetIndex: 1 },
  harvest: { label: "Harvest state", points: ["Harvest-ready", "Cut", "Post-harvest"], currentIndex: 0, targetIndex: 1 },
  build: { label: "Work state", points: ["Need identified", "Built / prepped", "Verified"], currentIndex: 0, targetIndex: 1 },
  venue: { label: "Space condition", points: ["Needs attention", "Presentable", "Guest-ready"], currentIndex: 0, targetIndex: 2 },
  water: { label: "Moisture", points: ["Dry", "Even moisture", "Saturated"], currentIndex: 0, targetIndex: 1 },
  propagation: { label: "Propagation state", points: ["Material ready", "Propagation set", "Rooting check"], currentIndex: 0, targetIndex: 1 },
  general: { label: "Task state", points: ["Ready", "Done", "Recorded"], currentIndex: 0, targetIndex: 1 },
};

const NATURAL_SEQUENCE_ROUTES = new Set<AtlasWorkRouteKey>(["weed", "plant", "seed", "crop_cycle", "harvest", "propagation"]);
const LINKED_SEQUENCE_METADATA = ["crop_cycle_id", "crop_cycle_key", "workflow_id", "workflow_key", "trail_key", "sequence_key", "maintenance_cycle_key", "recurrence_key", "booking_id", "booking_key", "event_id", "event_key", "venue_event_id", "project_id", "project_key"];

function titleCase(value: string) { return value.replaceAll("_", " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function firstObject(task: AtlasTaskCard) { return task.objects.find((object) => object.object_type === "bed") ?? task.objects[0] ?? null; }
function metadataString(task: AtlasTaskCard, keys: string[]) { for (const key of keys) { const value = atlasMetaString(task, key); if (value) return value; } return ""; }
function objectStateString(object: AtlasTaskCardObject | null, keys: string[]) { if (!object) return ""; for (const key of keys) { const value = object.state_metadata?.[key]; if (typeof value === "string" && value.trim()) return value.trim(); } return ""; }
function metadataIndex(task: AtlasTaskCard, key: string, fallback: 0 | 1 | 2) { const value = task.metadata?.[key]; const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return number === 0 || number === 1 || number === 2 ? number : fallback; }
function explicitPoints(task: AtlasTaskCard) { const candidates = [task.metadata?.condition_states, task.metadata?.condition_scale, task.metadata?.condition_points]; for (const candidate of candidates) { if (!Array.isArray(candidate)) continue; const values = candidate.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 3); if (values.length === 3) return values as [string, string, string]; } return null; }
function explicitTrailDecision(task: AtlasTaskCard) { const raw = task.metadata?.trail_mode ?? task.metadata?.trail_display ?? task.metadata?.has_trail ?? task.metadata?.condition_rail; if (raw === true) return true; if (raw === false) return false; if (typeof raw !== "string") return null; const value = raw.trim().toLowerCase(); if (["linked", "full", "on", "show", "true"].includes(value)) return true; if (["none", "off", "hide", "false", "one_time", "one-time"].includes(value)) return false; return null; }

export function taskHasMeaningfulTrail(task: AtlasTaskCard) {
  const explicit = explicitTrailDecision(task);
  if (explicit !== null) return explicit;
  const route = atlasRouteKeyForTask(task);
  if (route === "general") return false;
  if (NATURAL_SEQUENCE_ROUTES.has(route)) return true;
  if ((task.objects ?? []).length > 0) return true;
  if (task.task_series_key || task.engine_instance_key || task.generated_from_id || task.parent_task_id) return true;
  if (LINKED_SEQUENCE_METADATA.some((key) => Boolean(task.metadata?.[key]))) return true;
  if ((task.action_templates ?? []).some((template) => (template.unlocks ?? []).some((value) => typeof value === "string" && value.trim()))) return true;
  return false;
}

function waterCurrentIndex(value: string): 0 | 1 | 2 { const normalized = value.toLowerCase(); if (/saturat|soak|wet|waterlogged/.test(normalized)) return 2; if (/even|moist|okay|ok|good/.test(normalized)) return 1; return 0; }
function venueCurrentIndex(value: string): 0 | 1 | 2 { const normalized = value.toLowerCase(); if (/guest.?ready|ready/.test(normalized)) return 2; if (/presentable|acceptable/.test(normalized)) return 1; return 0; }
function genericCurrentIndex(value: string): 0 | 1 | 2 { const normalized = value.toLowerCase(); if (/maintained|clear|complete|verified|ready/.test(normalized)) return 2; if (/acceptable|presentable|partial|readable|planted|sown|observed|cut|set/.test(normalized)) return 1; return 0; }

function routeSpecificTemplate(task: AtlasTaskCard, route: AtlasWorkRouteKey): ConditionTemplate {
  const display = atlasTaskDisplay(task);
  const text = `${task.title} ${display.subject} ${display.location} ${atlasMetaString(task, "display_detail")}`.toLowerCase();
  const base = CONDITION_TEMPLATES[route];
  if (route === "venue" && /window|glass|door/.test(text)) return { label: "Glass condition", points: ["Marked", "Clear", "Guest-ready"], currentIndex: 0, targetIndex: 2 };
  if (route === "build" && /repair|fix|service|broken/.test(text)) return { label: "Equipment state", points: ["Out of service", "Repaired", "Verified"], currentIndex: 0, targetIndex: 1 };
  if (route === "seed" && /grow room|tray|seed shelf/.test(text)) return { ...base, label: "Tray state" };
  return base;
}

function recordedCondition(task: AtlasTaskCard, object: AtlasTaskCardObject | null, route: AtlasWorkRouteKey) {
  const explicit = metadataString(task, ["condition_now", "current_condition", "recorded_condition"]) || objectStateString(object, ["condition_now", "current_condition", "condition"]);
  if (explicit) return explicit;
  if (route === "weed" && atlasText(object?.weed_pressure)) { const pressure = titleCase(atlasText(object?.weed_pressure)); return /pressure$/i.test(pressure) ? pressure : `${pressure} pressure`; }
  if (route === "water" && atlasText(object?.water_status)) return titleCase(atlasText(object?.water_status));
  if (route === "venue" && atlasText(object?.presentability)) return titleCase(atlasText(object?.presentability));
  return "";
}

export function taskConditionRailModel(task: AtlasTaskCard): TaskConditionRailModel {
  const route = atlasRouteKeyForTask(task);
  const object = firstObject(task);
  const template = routeSpecificTemplate(task, route);
  const points = explicitPoints(task) ?? [...template.points] as [string, string, string];
  const recorded = recordedCondition(task, object, route);
  let currentIndex = metadataIndex(task, "condition_current_index", template.currentIndex);
  const targetIndex = metadataIndex(task, "condition_target_index", template.targetIndex);
  if (task.metadata?.condition_current_index === undefined && recorded) {
    if (route === "water") currentIndex = waterCurrentIndex(recorded);
    else if (route === "venue") currentIndex = venueCurrentIndex(recorded);
    else currentIndex = genericCurrentIndex(recorded);
  }
  const currentOverride = recorded;
  const middleOverride = metadataString(task, ["condition_middle", "intermediate_condition"]);
  const targetOverride = metadataString(task, ["condition_target", "target_condition", "done_condition", "completion_condition"]);
  const label = metadataString(task, ["condition_label", "condition_axis_label"]) || template.label;
  if (currentOverride) points[currentIndex] = titleCase(currentOverride);
  if (middleOverride) points[1] = middleOverride;
  if (targetOverride) points[targetIndex] = targetOverride;
  return { label, points, currentIndex, targetIndex, meaningful: taskHasMeaningfulTrail(task) };
}
