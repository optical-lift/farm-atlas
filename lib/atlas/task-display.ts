import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

export type AtlasWorkRouteKey = "plant" | "weed" | "mow" | "seed" | "harvest" | "build" | "venue" | "water";

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
  harvest: "Harvest",
  build: "Build / Prep",
  venue: "Venue",
  water: "Water",
};

export const atlasRouteOrder: AtlasWorkRouteKey[] = ["weed", "plant", "mow", "seed", "harvest", "build", "venue", "water"];

export function atlasText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function atlasStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export function atlasMetadataValue(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
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
  return value === "plant" || value === "weed" || value === "mow" || value === "seed" || value === "harvest" || value === "build" || value === "venue" || value === "water";
}

export function atlasRouteKeyForTask(task: AtlasTaskCard): AtlasWorkRouteKey {
  const explicit = atlasMetaString(task, "work_route");
  if (atlasIsRouteKey(explicit)) return explicit;

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
  if (route === "harvest") return "Harvest + Postharvest";
  if (route === "mow") return "Maintenance";
  if (route === "build") return "Build / Prep";
  if (route === "water") return "Watering";
  return "Farm Work";
}

export function atlasTaskSubject(task: AtlasTaskCard) {
  return atlasMetaString(task, "collection_label") || atlasMetaString(task, "display_subject") || atlasTitleSubject(task.title) || task.title;
}

export function atlasTaskLocation(task: AtlasTaskCard) {
  return atlasMetaString(task, "collection_zone") || atlasMetaString(task, "display_detail") || task.unlock_text || task.zone_label || "Elm Farm";
}

export function atlasTaskDetail(task: AtlasTaskCard) {
  return atlasStringList(atlasMetadataValue(task, "detail_lines"))[0] || task.unlock_text || atlasMetaString(task, "display_detail") || "Open task";
}

export function atlasTaskDisplay(task: AtlasTaskCard): AtlasTaskDisplay {
  const action = atlasActionForTask(task);
  const subject = atlasTaskSubject(task);
  return {
    action,
    subject,
    title: `${action} · ${subject}`,
    location: atlasTaskLocation(task),
    detail: atlasTaskDetail(task),
    route: atlasRouteKeyForTask(task),
    rhythm: atlasRhythmForTask(task),
  };
}
