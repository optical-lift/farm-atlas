import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasMetaString, atlasMetadataValue, atlasRouteKeyForTask, atlasTaskDisplay } from "@/lib/atlas/task-display";

export type AtlasWorkOrderAnchor = "top" | "morning" | "midday" | "visibility" | "evening" | "bottom";

export const atlasWorkOrderAnchors: Record<AtlasWorkOrderAnchor, { order: number; label: string }> = {
  top: { order: 10000, label: "Top of list" },
  morning: { order: 22000, label: "Morning work" },
  midday: { order: 42000, label: "Midday flex" },
  visibility: { order: 60000, label: "Visibility prep" },
  evening: { order: 76000, label: "Evening work" },
  bottom: { order: 99000, label: "Last thing" },
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

export function atlasMetaNumber(task: AtlasTaskCard, ...keys: string[]) {
  for (const key of keys) {
    const value = atlasMetadataValue(task, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function explicitAnchor(task: AtlasTaskCard): AtlasWorkOrderAnchor | null {
  const raw = lower(atlasMetadataValue(task, "work_order_anchor"))
    || lower(atlasMetadataValue(task, "day_flow_mode"))
    || lower(atlasMetadataValue(task, "day_work_order_mode"))
    || lower(atlasMetadataValue(task, "work_order_mode"));
  const label = `${lower(atlasMetadataValue(task, "day_work_order_label"))} ${lower(atlasMetadataValue(task, "work_order_label"))} ${lower(atlasMetadataValue(task, "work_order_bucket"))}`;

  if (raw === "bottom" || raw === "last" || raw === "last_thing" || label.includes("last thing")) return "bottom";
  if (raw === "evening" || raw === "lower" || label.includes("evening")) return "evening";
  if (raw === "visibility" || raw === "visibility_prep" || raw === "anchored" || label.includes("visibility")) return "visibility";
  if (raw === "midday" || raw === "midday_flex" || label.includes("midday")) return "midday";
  if (raw === "morning" || raw === "upper" || label.includes("morning")) return "morning";
  if (raw === "top" || raw === "first" || label.includes("top of list")) return "top";

  return null;
}

function taskText(task: AtlasTaskCard) {
  const display = atlasTaskDisplay(task);
  const details = Array.isArray(atlasMetadataValue(task, "detail_lines")) ? (atlasMetadataValue(task, "detail_lines") as unknown[]).join(" ") : "";
  return [
    task.task_type,
    task.title,
    task.unlock_text,
    task.note,
    task.zone_label,
    atlasMetaString(task, "collection_zone"),
    atlasMetaString(task, "collection_label"),
    atlasMetaString(task, "work_rhythm"),
    atlasMetaString(task, "display_action"),
    atlasMetaString(task, "display_subject"),
    display.route,
    display.title,
    details,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function atlasInferredWorkOrderAnchor(task: AtlasTaskCard): AtlasWorkOrderAnchor {
  const route = atlasRouteKeyForTask(task);
  const joined = taskText(task);

  if (joined.includes("mow") || joined.includes("mowing") || atlasMetaString(task, "work_collection_key") === "mowing") return "bottom";
  if (joined.includes("transplant") || joined.includes("planting") || route === "plant") return "evening";
  if (joined.includes("trash") || joined.includes("sweep porches") || joined.includes("porch") || joined.includes("guest") || joined.includes("venue reset") || joined.includes("visibility")) return "visibility";
  if (joined.includes("soil block") || joined.includes("blocking") || joined.includes("seed sowing") || joined.includes("sow ") || route === "seed") return "midday";
  if (joined.includes("weed") || joined.includes("ragweed") || joined.includes("hoe") || route === "weed") return "morning";
  if (joined.includes("harvest") || joined.includes("postharvest") || route === "harvest") return "morning";
  if (joined.includes("grow room") || joined.includes("water") || joined.includes("germination") || joined.includes("check trays") || route === "water" || route === "crop_cycle") return "top";

  return "midday";
}

export function atlasWorkOrderAnchorForTask(task: AtlasTaskCard): AtlasWorkOrderAnchor {
  return explicitAnchor(task) ?? atlasInferredWorkOrderAnchor(task);
}

export function atlasWorkOrderNumber(task: AtlasTaskCard) {
  const explicit = atlasMetaNumber(task, "day_work_order", "work_order", "day_order_override", "run_sheet_order");
  if (explicit !== null) return explicit;

  const anchor = atlasWorkOrderAnchorForTask(task);
  const dayOrder = atlasMetaNumber(task, "day_order") ?? 0;
  return atlasWorkOrderAnchors[anchor].order + Math.min(Math.max(dayOrder, 0), 999);
}

export function atlasWorkOrderLabel(task: AtlasTaskCard) {
  const explicit = atlasMetaString(task, "day_work_order_label") || atlasMetaString(task, "work_order_label") || atlasMetaString(task, "work_order_bucket");
  if (explicit) return explicit;
  return atlasWorkOrderAnchors[atlasWorkOrderAnchorForTask(task)].label;
}

export function atlasWorkOrderSortValue(task: AtlasTaskCard) {
  return `${task.due_date ?? "9999-12-31"}-${String(atlasWorkOrderNumber(task)).padStart(5, "0")}-${atlasTaskDisplay(task).title}`;
}
