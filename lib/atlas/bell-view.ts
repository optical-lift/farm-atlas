import type { AtlasBell, AtlasBellItem } from "@/lib/atlas/bell-contract";

export type AtlasBellView = "now" | "next" | "older";

export type AtlasBellQueueCounts = {
  now: number;
  next: number;
  older: number;
};

export type AtlasBellViewSummary = {
  eyebrow: string;
  status: string;
  title: string;
  emptyMessage: string;
};

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function unresolved(item: AtlasBellItem) {
  return !item.acknowledged;
}

function isNow(item: AtlasBellItem) {
  return !item.baseline && item.requiresAction && unresolved(item);
}

function isNext(item: AtlasBellItem) {
  return !item.baseline
    && item.eventKind === "rhythm_warning"
    && unresolved(item);
}

function isOlder(item: AtlasBellItem) {
  return item.baseline && item.requiresAction && unresolved(item);
}

function payloadDate(item: AtlasBellItem, key: string) {
  const value = item.payload?.[key];
  if (typeof value !== "string") return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function actionPriority(item: AtlasBellItem) {
  if (item.importance === "critical") return 0;
  if (item.eventKind === "rhythm_failure") return 1;
  if (item.sourceEvent === "blocked" || item.eventKind === "owner_decision") return 2;
  if (item.eventKind === "rhythm_due") return 3;
  if (item.sourceEvent === "reopened") return 4;
  return 5;
}

function sortNow(items: AtlasBellItem[]) {
  return [...items].sort((left, right) => {
    const priority = actionPriority(left) - actionPriority(right);
    if (priority !== 0) return priority;
    return Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  });
}

function sortNext(items: AtlasBellItem[]) {
  return [...items].sort((left, right) => payloadDate(left, "dueAt") - payloadDate(right, "dueAt"));
}

export function atlasBellQueueCounts(items: AtlasBellItem[]): AtlasBellQueueCounts {
  return {
    now: items.filter(isNow).length,
    next: items.filter(isNext).length,
    older: items.filter(isOlder).length,
  };
}

export function atlasBellItemsForView(items: AtlasBellItem[], view: AtlasBellView) {
  if (view === "next") return sortNext(items.filter(isNext));
  if (view === "older") return sortNow(items.filter(isOlder));
  return sortNow(items.filter(isNow));
}

export function atlasBellViewSummary(
  bell: AtlasBell,
  view: AtlasBellView,
  visibleItems = atlasBellItemsForView(bell.items, view),
): AtlasBellViewSummary {
  const count = visibleItems.length;

  if (view === "next") {
    return {
      eyebrow: "Plan ahead",
      status: `${count} coming up`,
      title: `${count} ${plural(count, "action")} coming up`,
      emptyMessage: "Nothing coming up.",
    };
  }

  if (view === "older") {
    return {
      eyebrow: "Older work",
      status: `${count} older`,
      title: `${count} older ${plural(count, "action")}`,
      emptyMessage: "No older work remains.",
    };
  }

  return {
    eyebrow: "Do now",
    status: `${count} to do`,
    title: `${count} ${plural(count, "action")} to do`,
    emptyMessage: "Nothing to do now.",
  };
}
