import type { AtlasTaskCard, AtlasTaskCardObject } from "@/lib/atlas/task-cards-client";
import { atlasMetaString, atlasRouteKeyForTask, atlasTaskDisplay, atlasText, type AtlasWorkRouteKey } from "@/lib/atlas/task-display";

export type TaskConditionRailModel = {
  label: string;
  points: [string, string, string];
  currentIndex: 0 | 1 | 2;
  targetIndex: 0 | 1 | 2;
};

type ConditionTemplate = {
  label: string;
  points: [string, string, string];
  currentIndex: 0 | 1 | 2;
  targetIndex: 0 | 1 | 2;
};

const CONDITION_TEMPLATES: Record<AtlasWorkRouteKey, ConditionTemplate> = {
  weed: {
    label: "Condition",
    points: ["Weeds present", "Row readable", "Row clear"],
    currentIndex: 0,
    targetIndex: 2,
  },
  plant: {
    label: "Site state",
    points: ["Site ready", "Planted", "Establishment check"],
    currentIndex: 0,
    targetIndex: 1,
  },
  mow: {
    label: "Route condition",
    points: ["Long growth", "Acceptable", "Maintained"],
    currentIndex: 0,
    targetIndex: 2,
  },
  seed: {
    label: "Bed state",
    points: ["Prepared", "Sown", "Germination watch"],
    currentIndex: 0,
    targetIndex: 1,
  },
  crop_cycle: {
    label: "Crop state",
    points: ["Signal due", "Observed", "Next gate ready"],
    currentIndex: 0,
    targetIndex: 1,
  },
  harvest: {
    label: "Harvest state",
    points: ["Harvest-ready", "Cut", "Post-harvest"],
    currentIndex: 0,
    targetIndex: 1,
  },
  build: {
    label: "Work state",
    points: ["Need identified", "Built / prepped", "Verified"],
    currentIndex: 0,
    targetIndex: 1,
  },
  venue: {
    label: "Space condition",
    points: ["Needs attention", "Presentable", "Guest-ready"],
    currentIndex: 0,
    targetIndex: 2,
  },
  water: {
    label: "Moisture",
    points: ["Dry", "Even moisture", "Saturated"],
    currentIndex: 0,
    targetIndex: 1,
  },
  propagation: {
    label: "Propagation state",
    points: ["Material ready", "Propagation set", "Rooting check"],
    currentIndex: 0,
    targetIndex: 1,
  },
};

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstObject(task: AtlasTaskCard) {
  return task.objects.find((object) => object.object_type === "bed") ?? task.objects[0] ?? null;
}

function metadataString(task: AtlasTaskCard, keys: string[]) {
  for (const key of keys) {
    const value = atlasMetaString(task, key);
    if (value) return value;
  }
  return "";
}

function objectStateString(object: AtlasTaskCardObject | null, keys: string[]) {
  if (!object) return "";
  for (const key of keys) {
    const value = object.state_metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function metadataIndex(task: AtlasTaskCard, key: string, fallback: 0 | 1 | 2) {
  const value = task.metadata?.[key];
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return number === 0 || number === 1 || number === 2 ? number : fallback;
}

function explicitPoints(task: AtlasTaskCard) {
  const candidates = [task.metadata?.condition_states, task.metadata?.condition_scale, task.metadata?.condition_points];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const values = candidate.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 3);
    if (values.length === 3) return values as [string, string, string];
  }
  return null;
}

function waterCurrentIndex(value: string): 0 | 1 | 2 {
  const normalized = value.toLowerCase();
  if (/saturat|soak|wet|waterlogged/.test(normalized)) return 2;
  if (/even|moist|okay|ok|good/.test(normalized)) return 1;
  return 0;
}

function venueCurrentIndex(value: string): 0 | 1 | 2 {
  const normalized = value.toLowerCase();
  if (/guest.?ready|ready/.test(normalized)) return 2;
  if (/presentable|acceptable/.test(normalized)) return 1;
  return 0;
}

function genericCurrentIndex(value: string): 0 | 1 | 2 {
  const normalized = value.toLowerCase();
  if (/maintained|clear|complete|verified|ready/.test(normalized)) return 2;
  if (/acceptable|presentable|partial|readable|planted|sown|observed|cut|set/.test(normalized)) return 1;
  return 0;
}

function routeSpecificTemplate(task: AtlasTaskCard, route: AtlasWorkRouteKey): ConditionTemplate {
  const display = atlasTaskDisplay(task);
  const text = `${task.title} ${display.subject} ${display.location} ${atlasMetaString(task, "display_detail")}`.toLowerCase();
  const base = CONDITION_TEMPLATES[route];

  if (route === "venue" && /window|glass|door/.test(text)) {
    return {
      label: "Glass condition",
      points: ["Marked", "Clear", "Guest-ready"],
      currentIndex: 0,
      targetIndex: 2,
    };
  }

  if (route === "build" && /repair|fix|service|broken/.test(text)) {
    return {
      label: "Equipment state",
      points: ["Out of service", "Repaired", "Verified"],
      currentIndex: 0,
      targetIndex: 1,
    };
  }

  if (route === "seed" && /grow room|tray|seed shelf/.test(text)) {
    return {
      ...base,
      label: "Tray state",
    };
  }

  return base;
}

function recordedCondition(task: AtlasTaskCard, object: AtlasTaskCardObject | null, route: AtlasWorkRouteKey) {
  const explicit = metadataString(task, ["condition_now", "current_condition", "recorded_condition"])
    || objectStateString(object, ["condition_now", "current_condition", "condition"]);
  if (explicit) return explicit;

  if (route === "weed" && atlasText(object?.weed_pressure)) {
    const pressure = titleCase(atlasText(object?.weed_pressure));
    return /pressure$/i.test(pressure) ? pressure : `${pressure} pressure`;
  }
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

  if (!task.metadata?.condition_current_index && recorded) {
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

  return {
    label,
    points,
    currentIndex,
    targetIndex,
  };
}
