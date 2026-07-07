import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

export type WorkRouteKey = "plant" | "weed" | "mow" | "seed" | "harvest" | "build" | "venue" | "water";

export type ZoneTaskOverview = {
  zone: string;
  tasks: AtlasTaskCard[];
  urgentCount: number;
  routeCounts: { key: WorkRouteKey; label: string; count: number }[];
};

export const routeOrder: WorkRouteKey[] = ["plant", "weed", "mow", "seed", "harvest", "build", "venue", "water"];

export const routeLabels: Record<WorkRouteKey, string> = {
  plant: "Plant",
  weed: "Weed",
  mow: "Mow",
  seed: "Seed",
  harvest: "Harvest",
  build: "Build",
  venue: "Venue",
  water: "Water",
};

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const urgentRoutes = new Set<WorkRouteKey>(["plant", "water", "harvest"]);
const terminalWords = new Set(["done", "complete", "completed", "dismissed", "expired", "archived", "cancelled", "canceled", "not_relevant", "not relevant", "changed_plan", "changed plan"]);

export function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function dateFromIso(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`);
}

export function addDaysIsoFrom(dateIso: string, days: number) {
  const date = dateFromIso(dateIso);
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function monthEndIso(dateIso: string) {
  const date = dateFromIso(dateIso);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
  const local = new Date(end.getTime() - end.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function monthName(dateIso: string) {
  const date = dateFromIso(dateIso);
  if (Number.isNaN(date.getTime())) return "Month";
  return date.toLocaleDateString("en-US", { month: "long" });
}

export function monthProgress(dateIso: string) {
  const date = dateFromIso(dateIso);
  if (Number.isNaN(date.getTime())) return { day: 0, days: 0, percent: 0 };
  const day = date.getDate();
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const percent = days ? Math.max(0, Math.min(100, Math.round((day / days) * 100))) : 0;
  return { day, days, percent };
}

export function prettyShortDate(dateIso: string | null | undefined) {
  if (!dateIso) return "unscheduled";
  const date = dateFromIso(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function meta(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
}

export function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export function isChildTask(task: AtlasTaskCard) {
  return meta(task, "is_child_task") === true || meta(task, "is_child_task") === "true";
}

function hasTerminalMetadata(task: AtlasTaskCard) {
  const metadata = task.metadata ?? {};
  const explicitHidden = metadata.hidden === true || metadata.dismissed === true || metadata.expired === true || metadata.archived === true;
  if (explicitHidden) return true;

  const values = [
    metadata.checklist_status,
    metadata.task_state,
    metadata.visibility,
    metadata.relevance,
    metadata.atlas_status,
  ].map((value) => text(value).toLowerCase()).filter(Boolean);

  return values.some((value) => terminalWords.has(value));
}

export function isRelevantOpenTask(task: AtlasTaskCard) {
  return task.status === "open" && !isChildTask(task) && !hasTerminalMetadata(task);
}

function isRouteKey(value: string | null): value is WorkRouteKey {
  return Boolean(value && routeOrder.includes(value as WorkRouteKey));
}

export function routeForTask(task: AtlasTaskCard): WorkRouteKey {
  const explicitRoute = text(meta(task, "work_route"));
  if (isRouteKey(explicitRoute)) return explicitRoute;

  const joined = `${task.task_type ?? ""} ${task.title ?? ""} ${text(meta(task, "work_rhythm"))} ${text(meta(task, "display_action"))}`.toLowerCase();
  if (joined.includes("water")) return "water";
  if (joined.includes("mow")) return "mow";
  if (joined.includes("weed")) return "weed";
  if (joined.includes("seed") || joined.includes("sow")) return "seed";
  if (joined.includes("harvest") || joined.includes("postharvest") || joined.includes("garlic") || joined.includes("gather")) return "harvest";
  if (joined.includes("build") || joined.includes("prep") || joined.includes("string") || joined.includes("arch")) return "build";
  if (joined.includes("plant") || joined.includes("transplant")) return "plant";
  return "venue";
}

export function subject(task: AtlasTaskCard) {
  return text(meta(task, "collection_label")) || text(meta(task, "display_subject")) || task.title.split("—").slice(1).join("—").trim() || task.title;
}

export function location(task: AtlasTaskCard) {
  return text(meta(task, "display_detail")) || task.unlock_text || task.zone_label || "Elm Farm";
}

export function detail(task: AtlasTaskCard) {
  return stringList(meta(task, "detail_lines"))[0] || location(task);
}

export function zoneBucket(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes("oak") || lower.includes("strawberry orchard")) return "Shady Oak";
  if (lower.includes("main garden") || lower.includes("straw strip")) return "Main Garden";
  if (lower.includes("field") || lower.includes("fr")) return "Field Rows";
  if (lower.includes("barn")) return "Barn Beds";
  if (lower.includes("berry") || lower.includes("bw")) return "Berry Walk";
  if (lower.includes("u-pick") || lower.includes("u pick")) return "U-Pick";
  if (lower.includes("follow me")) return "Follow Me";
  if (lower.includes("curve")) return "Curve Garden";
  if (lower.includes("lilac")) return "Lilac Haven";
  if (lower.includes("garage") || lower.includes("hydrangea")) return "Garage / House Beds";
  if (lower.includes("grow room")) return "Grow Room";
  if (lower.includes("entry") || lower.includes("billboard")) return "Entry Billboard";
  if (lower.includes("chicken")) return "Chicken Coop";
  return value || "Elm Farm";
}

export function collectionZone(task: AtlasTaskCard) {
  return text(meta(task, "collection_zone")) || zoneBucket(location(task));
}

export function taskSortValue(task: AtlasTaskCard) {
  const dayOrder = typeof meta(task, "day_order") === "number" ? meta(task, "day_order") : 999;
  return `${task.due_date ?? "9999-12-31"}-${priorityRank[task.priority] ?? 9}-${String(dayOrder).padStart(3, "0")}-${subject(task)}`;
}

function dueByPeriodEndOrUndated(task: AtlasTaskCard, endIso: string) {
  return !task.due_date || task.due_date <= endIso;
}

export function filterWeekOverviewTasks(cards: AtlasTaskCard[], anchorIso = todayIso()) {
  const weekEnd = addDaysIsoFrom(anchorIso, 6);
  return cards
    .filter(isRelevantOpenTask)
    .filter((task) => dueByPeriodEndOrUndated(task, weekEnd))
    .sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
}

export function filterMonthOverviewTasks(cards: AtlasTaskCard[], anchorIso = todayIso()) {
  const monthEnd = monthEndIso(anchorIso);
  return cards
    .filter(isRelevantOpenTask)
    .filter((task) => dueByPeriodEndOrUndated(task, monthEnd))
    .sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
}

export function isUrgentTask(task: AtlasTaskCard, anchorIso = todayIso()) {
  return isRelevantOpenTask(task) && Boolean(task.due_date && task.due_date < anchorIso && urgentRoutes.has(routeForTask(task)));
}

export function routeCountsForTasks(tasks: AtlasTaskCard[]) {
  return routeOrder
    .map((key) => ({ key, label: routeLabels[key], count: tasks.filter((task) => routeForTask(task) === key).length }))
    .filter((item) => item.count > 0);
}

export function routeCountLineForTasks(tasks: AtlasTaskCard[]) {
  const counts = routeCountsForTasks(tasks);
  return counts.length ? counts.map((item) => `${item.label} ${item.count}`).join(" · ") : "No open work";
}

export function groupTasksByZone(tasks: AtlasTaskCard[], anchorIso = todayIso()): ZoneTaskOverview[] {
  const groups = new Map<string, AtlasTaskCard[]>();
  tasks.forEach((task) => {
    const zone = collectionZone(task);
    groups.set(zone, [...(groups.get(zone) ?? []), task]);
  });

  return Array.from(groups.entries())
    .map(([zone, zoneTasks]) => {
      const sortedTasks = zoneTasks.sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
      return {
        zone,
        tasks: sortedTasks,
        urgentCount: sortedTasks.filter((task) => isUrgentTask(task, anchorIso)).length,
        routeCounts: routeCountsForTasks(sortedTasks),
      };
    })
    .sort((a, b) => b.tasks.length - a.tasks.length || a.zone.localeCompare(b.zone));
}
