import type { AtlasBell, AtlasBellItem } from "@/lib/atlas/bell-contract";
import { atlasBellIsMovementItem } from "@/lib/atlas/bell-action";

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

export function atlasBellIsManagementRole(role: string | null | undefined) {
  return role === "owner" || role === "manager";
}

function isManagementNow(item: AtlasBellItem) {
  return !item.baseline && item.requiresAction && unresolved(item);
}

function isManagementNext(item: AtlasBellItem) {
  return !item.baseline
    && item.eventKind === "rhythm_warning"
    && unresolved(item);
}

function isManagementOlder(item: AtlasBellItem) {
  return item.baseline && item.requiresAction && unresolved(item);
}

function isEmployeeFollowThrough(item: AtlasBellItem) {
  return atlasBellIsMovementItem(item) && item.requiresAction;
}

function payloadDate(item: AtlasBellItem, key: string) {
  const value = item.payload?.[key];
  if (typeof value !== "string") return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function payloadNumber(item: AtlasBellItem, key: string) {
  const value = item.payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function actionPriority(item: AtlasBellItem) {
  if (item.importance === "critical") return 0;
  if (item.eventKind === "rhythm_failure") return 1;
  if (item.sourceEvent === "blocked" || item.eventKind === "owner_decision") return 2;
  if (item.eventKind === "rhythm_due") return 3;
  if (item.sourceEvent === "reopened") return 4;
  return 5;
}

function sortManagementNow(items: AtlasBellItem[]) {
  return [...items].sort((left, right) => {
    const priority = actionPriority(left) - actionPriority(right);
    if (priority !== 0) return priority;
    return Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  });
}

function sortNext(items: AtlasBellItem[]) {
  return [...items].sort((left, right) => payloadDate(left, "dueAt") - payloadDate(right, "dueAt"));
}

function sortEmployeeFollowThrough(items: AtlasBellItem[]) {
  return [...items].sort((left, right) => {
    const movements = payloadNumber(right, "movementCount") - payloadNumber(left, "movementCount");
    if (movements !== 0) return movements;
    const due = payloadDate(left, "dueDate") - payloadDate(right, "dueDate");
    if (due !== 0) return due;
    return Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
  });
}

export function atlasBellQueueCounts(items: AtlasBellItem[], role?: string | null): AtlasBellQueueCounts {
  if (!atlasBellIsManagementRole(role)) {
    return {
      now: items.filter(isEmployeeFollowThrough).length,
      next: 0,
      older: 0,
    };
  }

  return {
    now: items.filter(isManagementNow).length,
    next: items.filter(isManagementNext).length,
    older: items.filter(isManagementOlder).length,
  };
}

export function atlasBellItemsForView(items: AtlasBellItem[], view: AtlasBellView, role?: string | null) {
  if (!atlasBellIsManagementRole(role)) {
    return sortEmployeeFollowThrough(items.filter(isEmployeeFollowThrough));
  }

  if (view === "next") return sortNext(items.filter(isManagementNext));
  if (view === "older") return sortManagementNow(items.filter(isManagementOlder));
  return sortManagementNow(items.filter(isManagementNow));
}

export function atlasBellViewSummary(
  bell: AtlasBell,
  view: AtlasBellView,
  visibleItems = atlasBellItemsForView(bell.items, view, bell.effectiveRole),
): AtlasBellViewSummary {
  const count = visibleItems.length;

  if (!atlasBellIsManagementRole(bell.effectiveRole)) {
    return {
      eyebrow: "Follow through",
      status: `${count} need finishing`,
      title: count === 1 ? "1 moved task needs finishing" : `${count} moved tasks need finishing`,
      emptyMessage: "No moved work needs finishing.",
    };
  }

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
