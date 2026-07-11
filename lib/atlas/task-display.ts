import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

export type AtlasWorkRouteKey = "plant" | "weed" | "mow" | "seed" | "crop_cycle" | "harvest" | "build" | "venue" | "water";

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
};

export const atlasRouteOrder: AtlasWorkRouteKey[] = ["weed", "plant", "mow", "seed", "crop_cycle", "harvest", "build", "venue", "water"];

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
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  return value === "plant" || value === "weed" || value === "mow" || value === "seed" || value === "crop_cycle" || value === "harvest" || value === "build" || value === "venue" || value === "water";
}

export function atlasIsCropCycleTask(task: AtlasTaskCard) {
  const metadata = task.metadata ?? {};
  const explicit = atlasMetaString(task, "work_route");
  const createdFrom = atlasMetaString(task, "created_from");
  const text = `${task.task_type ?? ""} ${task.title} ${task.unlock_text ?? ""} ${atlasMetaString(task, "work_rhythm") ?? ""} ${atlasMetaString(task, "display_action") ?? ""}`.toLowerCase();

  return explicit === "crop_cycle"
    || Boolean(metadata.crop_cycle_id || metadata.crop_cycle_key || metadata.crop_profile_stable_key)
    || createdFrom === "crop_cycle_triggered_sequence"
    || text.includes("crop cycle")
    || text.includes("germination")
    || text.includes("stand_check")
    || text.includes("harvest_watch")
    || text.includes("turnover_watch");
}

export function atlasRouteKeyForTask(task: AtlasTaskCard): AtlasWorkRouteKey {
  const explicit = atlasMetaString(task, "work_route");
  if (atlasIsRouteKey(explicit)) return explicit;
  if (atlasIsCropCycleTask(task)) return "crop_cycle";

  const templateText = (task.action_templates ?? [])
    .map((template) => `${template.action_type ?? ""} ${template.template_label ?? ""} ${template.card_language ?? ""}`)
    .join(" ");

  const joined = `${task.task_type ?? ""} ${task.title} ${task.unlock_text ?? ""} ${atlasMetaString(task, "work_rhythm") ?? ""} ${atlasMetaString(task, "display_action") ?? ""} ${templateText}`.toLowerCase();

  if (joined.includes("water")) return "water";
  if (joined.includes("mow")) return "mow";
  if (joined.includes("weed")) return "weed";
  if (joined.includes("seed") || joined.includes("sow")) return "seed";
  if (joined.includes("harvest") || joined.includes("postharvest") || joined.includes("garlic") || joined.includes("gather")) return "harvest";
  if (joined.includes("build") || joined.includes("prep") || joined.includes("string") || joined.includes("arch")) return "build";
  if (joined.includes("plant") || joined.includes("transplant")) return "plant";

  return "venue";
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
  return "Farm Work";
}

export function atlasTaskSubject(task: AtlasTaskCard) {
  return atlasMetaString(task, "collection_label") || atlasMetaString(task, "display_subject") || atlasTitleSubject(task.title) || task.title;
}

function uniqueObjectLabels(task: AtlasTaskCard) {
  return Array.from(new Set((task.objects ?? []).map((object) => object.object_label).filter(Boolean)));
}

export function atlasTaskObjectLocation(task: AtlasTaskCard) {
  const labels = uniqueObjectLabels(task);
  if (labels.length === 0) return null;
  if (labels.length <= 3) return labels.join(" · ");
  return `${labels.length} attached spaces`;
}

export function atlasTaskLocation(task: AtlasTaskCard) {
  return atlasTaskObjectLocation(task) || atlasMetaString(task, "collection_zone") || atlasMetaString(task, "display_detail") || task.unlock_text || task.zone_label || "Elm Farm";
}

export function atlasTaskDetail(task: AtlasTaskCard) {
  if (atlasIsCropCycleTask(task)) {
    const crop = [atlasMetaString(task, "crop_variety"), atlasMetaString(task, "crop_label")].filter(Boolean).join(" ");
    const object = atlasTaskObjectLocation(task) || atlasMetaString(task, "collection_zone");
    const anchor = atlasMetaString(task, "trigger_anchor_date");
    const generated = anchor ? `generated from ${anchor}` : "generated from crop cycle";
    const fallback = [crop || atlasMetaString(task, "display_detail"), object, generated].filter(Boolean).join(" · ");
    return atlasStringList(atlasMetadataValue(task, "detail_lines"))[0] || fallback || task.unlock_text || "Crop-cycle follow-up";
  }

  return atlasStringList(atlasMetadataValue(task, "detail_lines"))[0] || task.unlock_text || atlasMetaString(task, "display_detail") || "Open task";
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
  return {
    action,
    subject,
    title: storedTitle || `${action} · ${subject}`,
    location: atlasTaskLocation(task),
    detail: atlasTaskDetail(task),
    route: atlasRouteKeyForTask(task),
    rhythm: atlasRhythmForTask(task),
  };
}
