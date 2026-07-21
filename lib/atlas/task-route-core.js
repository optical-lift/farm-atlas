export const ATLAS_SCHEDULE_ROUTE_LABELS = Object.freeze({
  weed: "Weeding",
  mow: "Mowing",
  sow: "Sowing",
  plant: "Planting",
  harvest: "Harvest",
  water: "Watering",
  care: "Crop Care",
  maintain: "Venue + Maintenance",
  other: "Farm Work",
});

export function atlasScheduleRouteKey(task) {
  const taskType = typeof task?.taskType === "string" ? task.taskType.toLowerCase() : "";
  const title = typeof task?.title === "string" ? task.title.toLowerCase() : "";
  const instruction = typeof task?.instruction === "string" ? task.instruction.toLowerCase() : "";
  const joined = `${taskType} ${title} ${instruction}`;

  if (taskType === "mowing" || title.startsWith("mowing ") || title.startsWith("mowing—") || title.startsWith("mowing —")) return "mow";
  if (taskType === "weed_control" || title.startsWith("weed ") || title.startsWith("cut back weeds") || joined.includes(" hoe ")) return "weed";
  if (joined.includes("harvest") || joined.includes("cut flower")) return "harvest";
  if (joined.includes("water") || joined.includes("irrigat")) return "water";
  if (joined.includes("transplant") || joined.includes("plant ")) return "plant";
  if (joined.includes("sow") || joined.includes("seed")) return "sow";
  if (joined.includes("germin") || joined.includes("thin") || joined.includes("pinch")) return "care";
  if (
    joined.includes("maint") ||
    joined.includes("paint") ||
    joined.includes("trim") ||
    joined.includes("clean") ||
    joined.includes("repair")
  ) {
    return "maintain";
  }
  return "other";
}

export function atlasIsMaintenanceCollectionRoute(routeKey) {
  return routeKey === "weed" || routeKey === "mow";
}
