import type { AtlasTaskCard, AtlasTaskCardObject } from "@/lib/atlas/task-cards-client";
import { atlasMetaString, atlasTaskDisplay } from "@/lib/atlas/task-display";

export const ATLAS_VENUE_ROOM_ORDER = [
  "Lounge",
  "Library",
  "Kitchen",
  "Conference Room",
  "Bathroom",
  "Studio",
] as const;

const PERSON_BUCKETS = new Set(["anna", "marshall", "owner", "kids", "children", "farm team", "farm_team"]);

export function atlasTaskRoom(task: AtlasTaskCard): AtlasTaskCardObject | null {
  return (task.objects ?? []).find((object) => object.object_type === "room") ?? null;
}

export function atlasTaskHasRoom(task: AtlasTaskCard) {
  return Boolean(atlasTaskRoom(task));
}

export function atlasTasksHaveRooms(tasks: AtlasTaskCard[]) {
  return tasks.some(atlasTaskHasRoom);
}

export function atlasTaskOperationalArea(task: AtlasTaskCard) {
  const room = atlasTaskRoom(task);
  if (room) return room.object_label;

  const explicitArea = atlasMetaString(task, "operational_area");
  if (explicitArea) return explicitArea;

  if (task.zone_label) return task.zone_label;

  const collection = atlasMetaString(task, "collection_zone");
  if (collection && !PERSON_BUCKETS.has(collection.toLowerCase())) return collection;

  return atlasTaskDisplay(task).location || "Elm Farm";
}

export function atlasTaskWorkCategoryLabel(task: AtlasTaskCard) {
  const explicit = atlasMetaString(task, "work_category_label");
  if (explicit) return explicit;

  const joined = `${task.task_type ?? ""} ${task.title} ${task.note ?? ""}`.toLowerCase();
  if (joined.includes("sign")) return "Signage + safety";
  if (joined.includes("stair") || joined.includes("tread")) return "Access + safety";
  if (joined.includes("window")) return "Windows";
  if (joined.includes("floor")) return "Flooring";
  if (joined.includes("white board") || joined.includes("whiteboard") || joined.includes("hutch") || joined.includes("basket bracket")) return "Furnishings + installation";
  if (joined.includes("trim") || joined.includes("wallpaper") || joined.includes("paint") || joined.includes("stain")) return "Trim + finish";
  if (joined.includes("door") || joined.includes("hardware") || joined.includes("lock")) return "Doors + hardware";
  if (joined.includes("wire") || joined.includes("outlet") || joined.includes("light fixture")) return "Electrical + lighting";
  if (joined.includes("pipe") || joined.includes("plumb") || joined.includes("leak")) return "Plumbing";
  if (joined.includes("clean") || joined.includes("tidy")) return "Cleaning + presentation";
  return atlasTaskDisplay(task).rhythm || "Farm work";
}

function roomOrder(label: string) {
  const index = ATLAS_VENUE_ROOM_ORDER.indexOf(label as (typeof ATLAS_VENUE_ROOM_ORDER)[number]);
  if (index >= 0) return index;
  if (label === "Venue") return ATLAS_VENUE_ROOM_ORDER.length;
  if (label === "Private House" || label === "Farmhouse Interior") return ATLAS_VENUE_ROOM_ORDER.length + 1;
  return ATLAS_VENUE_ROOM_ORDER.length + 2;
}

export function atlasOperationalAreaSort(a: string, b: string) {
  const orderDifference = roomOrder(a) - roomOrder(b);
  return orderDifference || a.localeCompare(b);
}
