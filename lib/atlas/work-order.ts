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
  return text(value).toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
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

  if (raw === "bottom" || raw === "last" || raw === "last_thing" || label.includes("last_thing")) return "bottom";
  if (raw === "evening" || raw === "lower" || label.includes("evening")) return "evening";
  if (raw === "visibility" || raw === "visibility_prep" || raw === "anchored" || label.includes("visibility")) return "visibility";
  if (raw === "midday" || raw === "midday_flex" || label.includes("midday")) return "midday";
  if (raw === "morning" || raw === "upper" || label.includes("morning")) return "morning";
  if (raw === "top" || raw === "first" || label.includes("top_of_list")) return "top";

  return null;
}

function isSeedSowing(task: AtlasTaskCard) {
  const route = atlasRouteKeyForTask(task);
  const action = lower(task.action_key);
  const taskType = lower(task.task_type);
  const rhythm = lower(atlasMetaString(task, "work_rhythm"));
  return route === "seed"
    || action === "sow"
    || action === "seed"
    || taskType === "sowing"
    || rhythm === "seed_sowing";
}

/**
 * Fallback ordering is allowed to use controlled task fields only. Title prose
 * is presentation, not an operational clock or work-class source.
 */
export function atlasInferredWorkOrderAnchor(task: AtlasTaskCard): AtlasWorkOrderAnchor {
  const route = atlasRouteKeyForTask(task);
  const action = lower(task.action_key);
  const taskType = lower(task.task_type);
  const rhythm = lower(atlasMetaString(task, "work_rhythm"));
  const category = lower(atlasMetaString(task, "work_category_key"));
  const collection = lower(atlasMetaString(task, "work_collection_key"));

  if (route === "mow" || action === "mow" || collection === "mowing") return "bottom";
  if (route === "plant" || action === "plant" || action === "transplant") return "evening";
  if (["signage_safety", "hospitality", "guest_readiness", "venue_reset"].includes(category)) return "visibility";
  if (route === "seed" || action === "sow" || action === "seed" || rhythm === "seed_sowing") return "evening";
  if (route === "weed" || action === "weed" || collection === "weeding") return "morning";
  if (route === "harvest" || action === "harvest" || taskType === "postharvest") return "morning";
  if (
    route === "water"
    || route === "crop_cycle"
    || action === "water"
    || taskType === "grow_room_care"
    || taskType === "germination_check"
  ) return "top";

  return "midday";
}

export function atlasWorkOrderAnchorForTask(task: AtlasTaskCard): AtlasWorkOrderAnchor {
  // Seed sowing is a canonical evening operation. Old planner metadata must not
  // pull sowing back into an afternoon bucket.
  if (isSeedSowing(task)) return "evening";
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
