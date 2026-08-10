import type { AtlasTaskCard, AtlasTaskCardObject } from "@/lib/atlas/task-cards-client";

export type AtlasWorkRouteKey = "plant" | "weed" | "mow" | "seed" | "crop_cycle" | "harvest" | "build" | "venue" | "water" | "propagation" | "general";

export type AtlasTaskDisplay = {
  action: string;
  subject: string;
  title: string;
  location: string;
  detail: string;
  route: AtlasWorkRouteKey;
  rhythm: string;
};

export const atlasRouteLabels: Record<AtlasWorkRouteKey, string> = {
  plant: "Plant",
  weed: "Weed",
  mow: "Mow",
  seed: "Seed",
  crop_cycle: "Crop Cycle",
  harvest: "Harvest",
  build: "Build / Prep",
  venue: "Venue",
  water: "Water",
  propagation: "Propagation",
  general: "Task",
};

export const atlasRouteOrder: AtlasWorkRouteKey[] = ["weed", "plant", "propagation", "mow", "seed", "crop_cycle", "harvest", "build", "venue", "water", "general"];

export function atlasText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function atlasStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function isChickenTendingTask(task: AtlasTaskCard) {
  const text = `${task.task_type ?? ""} ${task.title ?? ""} ${task.unlock_text ?? ""} ${task.metadata?.display_action ?? ""} ${task.metadata?.display_subject ?? ""}`.toLowerCase();
  return text.includes("feed chicken") || text.includes("tend chicken") || text.includes("chicken chore");
}

export function atlasMetadataValue(task: AtlasTaskCard, key: string) {
  const stored = task.metadata?.[key];
  if (stored !== undefined && stored !== null) return stored;
  if ((key === "quiet_task" || key === "hide_from_home_hero") && isChickenTendingTask(task)) return true;
  return stored;
}

export function atlasMetaString(task: AtlasTaskCard, key: string) {
  const value = atlasMetadataValue(task, key);
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function atlasCleanLabel(value: string | null | undefined) {
  return (value ?? "")
    .replace(/truth/gi, "state")
    .replace(/\b(urgent|high|normal|low)\b/gi, "")
    .replace(/\s+·\s+·\s+/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

export function atlasTitleSubject(title: string) {
  const parts = title.split("—");
  return atlasCleanLabel(parts.length > 1 ? parts.slice(1).join("—") : title);
}

export function atlasIsRouteKey(value: string | null | undefined): value is AtlasWorkRouteKey {
  return value === "plant" || value === "weed" || value === "mow" || value === "seed" || value === "crop_cycle" || value === "harvest" || value === "build" || value === "venue" || value === "water" || value === "propagation" || value === "general";
}

export function atlasIsCropCycleTask(task: AtlasTaskCard) {
  const metadata = task.metadata ?? {};
  const explicit = atlasMetaString(task, "work_route");
  const createdFrom = atlasMetaString(task, "created_from");
  const text = `${task.task_type ?? ""} ${task.title} ${task.unlock_text ?? ""} ${atlasMetaString(task, "work_rhythm")} ${atlasMetaString(task, "display_action")}`.toLowerCase();

  return explicit === "crop_cycle"
    || Boolean(metadata.crop_cycle_id || metadata.crop_cycle_key || metadata.crop_profile_stable_key)
    || createdFrom === "crop_cycle_triggered_sequence"
    || text.includes("crop cycle")
    || text.includes("germination")
    || text.includes("stand_check")
    || text.includes("harvest_watch")
    || text.includes("turnover_watch");
}

function normalizedRoute(value: string) : AtlasWorkRouteKey | null {
  if (atlasIsRouteKey(value)) return value;
  if (value === "weeding") return "weed";
  if (value === "mowing") return "mow";
  if (value === "watering") return "water";
  if (value === "planting" || value === "transplant") return "plant";
  if (value === "sowing" || value === "sow" || value === "seed_sowing") return "seed";
  if (["propagate", "propagation_start", "propagation_count", "check_rooting", "pot_rooted_cuttings"].includes(value)) return "propagation";
  if (["call", "phone", "research", "purchase", "buy", "check", "inspect", "transplant_readiness", "pot_up", "move", "load", "deliver", "pickup"].includes(value)) return "general";
  return null;
}

export function atlasRouteKeyForTask(task: AtlasTaskCard): AtlasWorkRouteKey {
  const action = atlasText(task.action_key).toLowerCase();
  const workRoute = atlasMetaString(task, "work_route").toLowerCase();
  const actionRoute = normalizedRoute(action);
  if (actionRoute) return actionRoute;
  const workRouteKey = normalizedRoute(workRoute);
  if (workRouteKey) return workRouteKey;

  const explicitCollection = atlasMetaString(task, "work_collection_key");
  const explicitRhythm = atlasMetaString(task, "work_rhythm").toLowerCase();
  if (explicitCollection === "propagation" || explicitRhythm === "propagation") return "propagation";

  if (atlasIsCropCycleTask(task)) return "crop_cycle";

  const templateText = (task.action_templates ?? [])
    .map((template) => `${template.action_type ?? ""} ${template.template_label ?? ""} ${template.card_language ?? ""}`)
    .join(" ");

  const joined = `${task.task_type ?? ""} ${task.title} ${task.unlock_text ?? ""} ${atlasMetaString(task, "work_rhythm")} ${atlasMetaString(task, "display_action")} ${templateText}`.toLowerCase();

  if (joined.includes("propagat") || joined.includes("take cuttings") || joined.includes("root cuttings")) return "propagation";
  if (joined.includes("water")) return "water";
  if (joined.includes("mow")) return "mow";
  if (joined.includes("weed")) return "weed";
  if (joined.includes("seed") || joined.includes("sow")) return "seed";
  if (joined.includes("harvest") || joined.includes("postharvest") || joined.includes("garlic") || joined.includes("gather")) return "harvest";
  if (joined.includes("build") || joined.includes("prep") || joined.includes("string") || joined.includes("arch")) return "build";
  if (joined.includes("plant") || joined.includes("transplant")) return "plant";
  if (joined.includes("venue") || joined.includes("guest") || joined.includes("clean") || joined.includes("wash") || joined.includes("window")) return "venue";

  return "general";
}

export function atlasActionForTask(task: AtlasTaskCard) {
  const explicit = atlasMetaString(task, "display_action");
  if (explicit) return explicit;

  if (atlasIsCropCycleTask(task)) {
    const type = `${task.task_type ?? ""} ${task.title}`.toLowerCase();
    if (type.includes("germination")) return "Check";
    if (type.includes("stand")) return "Patch/thin";
    if (type.includes("harvest")) return "Watch";
    if (type.includes("turnover") || type.includes("clear")) return "Clear";
    return "Crop Cycle";
  }

  const templateAction = task.action_templates?.find((template) => atlasText(template.action_type))?.action_type;
  if (templateAction) return atlasCleanLabel(templateAction.replaceAll("_", " ")).replace(/^./, (letter) => letter.toUpperCase());

  return atlasRouteLabels[atlasRouteKeyForTask(task)];
}

export function atlasRhythmForTask(task: AtlasTaskCard) {
  const explicit = atlasMetaString(task, "work_rhythm");
  if (explicit) return explicit;

  const route = atlasRouteKeyForTask(task);
  if (route === "plant") return "Planting";
  if (route === "weed") return "Weeding";
  if (route === "seed") return "Seed Sowing";
  if (route === "crop_cycle") return "Crop Cycle";
  if (route === "harvest") return "Harvest + Postharvest";
  if (route === "mow") return "Maintenance";
  if (route === "build") return "Build / Prep";
  if (route === "water") return "Watering";
  if (route === "propagation") return "Propagation";
  return "Farm Work";
}

export function atlasTaskSubject(task: AtlasTaskCard) {
  return atlasMetaString(task, "display_subject") || atlasTitleSubject(task.title) || atlasMetaString(task, "collection_label") || task.title;
}

function uniqueObjectLabels(task: AtlasTaskCard) {
  return Array.from(new Set((task.objects ?? []).map((object) => object.object_label).filter(Boolean)));
}

function primaryTaskObject(task: AtlasTaskCard): AtlasTaskCardObject | null {
  const targetObjectId = atlasMetaString(task, "target_object_id");
  if (targetObjectId) {
    const target = (task.objects ?? []).find((object) => object.object_id === targetObjectId);
    if (target) return target;
  }

  const bed = (task.objects ?? []).find((object) => object.object_type === "bed");
  return bed ?? task.objects?.[0] ?? null;
}

function objectMainCropLabel(task: AtlasTaskCard) {
  const explicit = atlasMetaString(task, "main_crop_label");
  if (explicit) return explicit;

  const object = primaryTaskObject(task);
  return atlasText(object?.state_metadata?.main_crop_label);
}

function titleWithMainCrop(task: AtlasTaskCard, title: string) {
  const object = primaryTaskObject(task);
  const crop = objectMainCropLabel(task);
  const objectLabel = atlasText(object?.object_label);
  if (!crop || !objectLabel || title.toLowerCase().includes(crop.toLowerCase())) return title;

  const objectIndex = title.toLowerCase().indexOf(objectLabel.toLowerCase());
  if (objectIndex < 0) return title;

  const objectEnd = objectIndex + objectLabel.length;
  return `${title.slice(0, objectEnd)} ${crop}${title.slice(objectEnd)}`;
}

export function atlasTaskObjectLocation(task: AtlasTaskCard) {
  const labels = uniqueObjectLabels(task);
  if (labels.length === 0) return null;
  if (labels.length <= 3) return labels.join(" · ");
  return `${labels.length} attached spaces`;
}

function usableCollectionLocation(task: AtlasTaskCard) {
  const collection = atlasMetaString(task, "collection_zone");
  if (!collection) return "";
  const normalized = collection.toLowerCase();
  if (["owner", "marshall", "kids", "children", "anna", "farm team", "farm_team", "network"].includes(normalized)) return "";
  return collection;
}

export function atlasTaskLocation(task: AtlasTaskCard) {
  return atlasMetaString(task, "execution_place")
    || atlasMetaString(task, "display_location")
    || atlasTaskObjectLocation(task)
    || task.zone_label
    || usableCollectionLocation(task)
    || atlasMetaString(task, "display_detail")
    || task.unlock_text
    || "Elm Farm";
}

export function atlasTaskContinuation(task: AtlasTaskCard) {
  const latest = task.task_outcomes?.[0];
  if (!latest || (latest.outcome !== "partial" && latest.outcome !== "blocked")) return "";

  const outcomeLabel = latest.outcome === "partial" ? "Partly done" : "Problem found";
  const reason = atlasCleanLabel(latest.blocker_reason || latest.note || "");
  const normalizedReason = reason.toLowerCase();
  const normalizedOutcome = outcomeLabel.toLowerCase();
  return [
    "Continued",
    outcomeLabel,
    reason && normalizedReason !== normalizedOutcome ? reason : "",
  ].filter(Boolean).join(" · ");
}

export function atlasTaskDetail(task: AtlasTaskCard) {
  const continuation = atlasTaskContinuation(task);
  if (continuation) return continuation;

  if (atlasIsCropCycleTask(task)) {
    const crop = [atlasMetaString(task, "crop_variety"), atlasMetaString(task, "crop_label")].filter(Boolean).join(" ");
    const object = atlasTaskObjectLocation(task) || usableCollectionLocation(task);
    const anchor = atlasMetaString(task, "trigger_anchor_date");
    const generated = anchor ? `generated from ${anchor}` : "generated from crop cycle";
    const fallback = [crop || atlasMetaString(task, "display_detail"), object, generated].filter(Boolean).join(" · ");
    return atlasStringList(atlasMetadataValue(task, "detail_lines"))[0] || fallback || task.unlock_text || "Crop-cycle follow-up";
  }

  const detailLine = atlasStringList(atlasMetadataValue(task, "detail_lines"))[0];
  const explicitDetail = atlasMetaString(task, "display_detail").replace(/^one-bed daily weeding block\s*·\s*/i, "").trim();
  if (task.task_type === "grow_room_care" && !detailLine && !task.unlock_text && !explicitDetail) return "";

  return detailLine || task.unlock_text || explicitDetail || "Open task";
}

function normalizedStoredTitle(task: AtlasTaskCard) {
  const explicit = atlasMetaString(task, "display_title");
  if (explicit) return atlasCleanLabel(explicit.replace(/\s+[—-]\s+/g, " · "));

  const stored = atlasCleanLabel(task.title.replace(/\s+[—-]\s+/g, " · "));
  if (/^kid chore\s*·/i.test(stored)) return stored;
  return null;
}

export function atlasTaskDisplay(task: AtlasTaskCard): AtlasTaskDisplay {
  const storedTitle = normalizedStoredTitle(task);
  const action = storedTitle?.split("·")[0]?.trim() || atlasActionForTask(task);
  const subject = storedTitle?.split("·").slice(1).join("·").trim() || atlasTaskSubject(task);
  const title = titleWithMainCrop(task, storedTitle || `${action} · ${subject}`);
  return {
    action,
    subject,
    title,
    location: atlasTaskLocation(task),
    detail: atlasTaskDetail(task),
    route: atlasRouteKeyForTask(task),
    rhythm: atlasRhythmForTask(task),
  };
}
