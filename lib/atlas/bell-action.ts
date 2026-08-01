import type { AtlasBellItem } from "@/lib/atlas/bell-contract";

export type AtlasBellActionState = "overdue" | "due" | "upcoming" | "decision" | "blocked" | "older" | "open";

export type AtlasBellConsequence = {
  label: "Unlocks" | "Result";
  text: string;
};

function payloadText(item: AtlasBellItem, key: string) {
  const value = item.payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function payloadNumber(item: AtlasBellItem, key: string) {
  const value = item.payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function payloadTextArray(item: AtlasBellItem, key: string) {
  const value = item.payload?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim());
}

function stripEventState(title: string) {
  return title
    .replace(/\s+weed rhythm fell out of rhythm$/i, "")
    .replace(/\s+weed rhythm is coming due$/i, "")
    .replace(/\s+weed rhythm is due$/i, "")
    .replace(/\s+rhythm fell out of rhythm$/i, "")
    .replace(/\s+rhythm is coming due$/i, "")
    .replace(/\s+rhythm is due$/i, "")
    .trim();
}

function stripTaskPrefix(title: string) {
  return title
    .replace(/^Checklist\s*[—-]\s*/i, "")
    .replace(/^Task\s*[—-]\s*/i, "")
    .trim();
}

function rhythmSubject(item: AtlasBellItem) {
  return stripEventState(item.title);
}

function dueDateLabel(item: AtlasBellItem) {
  const dueAt = payloadText(item, "dueAt");
  if (!dueAt) return null;
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dateOnlyTimestamp(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function atlasBellMovementCount(item: AtlasBellItem) {
  return payloadNumber(item, "movementCount") ?? 0;
}

export function atlasBellIsMovementItem(item: AtlasBellItem) {
  return item.eventKind === "task_result"
    && item.sourceEvent === "rescheduled"
    && atlasBellMovementCount(item) > 0;
}

export function atlasBellConsequence(item: AtlasBellItem): AtlasBellConsequence | null {
  const unlockTargets = payloadTextArray(item, "unlockTaskTitles");
  if (unlockTargets.length > 0) {
    return {
      label: "Unlocks",
      text: unlockTargets.join(" · "),
    };
  }

  const resultText = payloadText(item, "resultText");
  if (resultText) {
    return {
      label: "Result",
      text: resultText,
    };
  }

  return null;
}

export function atlasBellActionTitle(item: AtlasBellItem) {
  if (atlasBellIsMovementItem(item)) {
    return stripTaskPrefix(payloadText(item, "taskTitle") ?? item.title);
  }

  const rhythmKey = payloadText(item, "rhythmKey");
  const subject = rhythmSubject(item);

  if (rhythmKey === "weed_stewardship") return `Weed ${subject}`;

  if (rhythmKey === "mowing") {
    const parts = subject.split("·").map((part) => part.trim()).filter(Boolean);
    const location = parts[0]?.toLowerCase() === "mowing" ? parts.slice(1) : parts;
    return `Mow ${location.join(" — ") || subject}`;
  }

  if (rhythmKey === "germination_watch") return "Check germination trays";
  if (rhythmKey === "grow_room_care") return "Complete Grow Room care";
  if (rhythmKey === "watering" || rhythmKey === "irrigation") return `Water ${subject}`;
  if (rhythmKey === "harvest") return `Harvest ${subject}`;
  if (rhythmKey === "observation") return `Check ${subject}`;

  const taskTitle = stripTaskPrefix(item.title);
  if (item.eventKind === "owner_decision") return `Decide: ${taskTitle}`;
  if (item.sourceEvent === "blocked") return `Resolve the block on ${taskTitle}`;
  if (item.sourceEvent === "reopened") return `Finish ${taskTitle}`;
  if (item.eventKind === "unlock") return `Start ${taskTitle}`;
  if (item.eventKind === "production_change") return `Review ${taskTitle}`;
  if (item.eventKind.startsWith("rhythm_")) return `Complete ${subject}`;
  if (item.requiresAction) return taskTitle;
  return `Review ${taskTitle}`;
}

export function atlasBellActionState(item: AtlasBellItem): AtlasBellActionState {
  if (atlasBellIsMovementItem(item)) {
    const due = dateOnlyTimestamp(payloadText(item, "dueDate"));
    const today = dateOnlyTimestamp(payloadText(item, "farmToday"));
    if (due !== null && today !== null && due < today) return "overdue";
    return "due";
  }

  if (item.baseline) return "older";
  if (item.eventKind === "rhythm_failure") return "overdue";
  if (item.eventKind === "rhythm_due") return "due";
  if (item.eventKind === "rhythm_warning") return "upcoming";
  if (item.eventKind === "owner_decision") return "decision";
  if (item.sourceEvent === "blocked") return "blocked";
  return "open";
}

export function atlasBellActionTiming(item: AtlasBellItem) {
  if (atlasBellIsMovementItem(item)) {
    const movementCount = atlasBellMovementCount(item);
    const movementLabel = movementCount === 1 ? "Moved once" : `Moved ${movementCount} times`;
    const due = dateOnlyTimestamp(payloadText(item, "dueDate"));
    const today = dateOnlyTimestamp(payloadText(item, "farmToday"));

    if (due !== null && today !== null) {
      const dayDifference = Math.round((today - due) / 86_400_000);
      if (dayDifference === 0) return `${movementLabel} · Due today`;
      if (dayDifference > 0) return `${movementLabel} · ${dayDifference} ${dayDifference === 1 ? "day" : "days"} overdue`;
    }

    return movementLabel;
  }

  const state = atlasBellActionState(item);
  if (state === "older") return "Older open work";
  if (state === "overdue") return "Overdue";
  if (state === "due") return "Due now";
  if (state === "upcoming") {
    const due = dueDateLabel(item);
    return due ? `Due ${due}` : "Coming up";
  }
  if (state === "decision") return "Decision needed";
  if (state === "blocked") return "Resolve before work can continue";
  if (item.sourceEvent === "reopened") return "Still open";
  if (item.importance === "critical") return "Urgent";
  return "Open action";
}

export function atlasBellActionSymbol(item: AtlasBellItem) {
  if (atlasBellIsMovementItem(item)) return "↺";
  const state = atlasBellActionState(item);
  if (state === "overdue" || state === "blocked") return "!";
  if (state === "decision") return "?";
  if (state === "upcoming") return "○";
  if (state === "older") return "↺";
  return "→";
}

export function atlasBellOpenLabel(item: AtlasBellItem) {
  if (atlasBellIsMovementItem(item)) return "Go to task";
  const rhythmKey = payloadText(item, "rhythmKey");
  if (rhythmKey === "weed_stewardship") return "Open Weed Card";
  if (item.taskId) return "Open task";
  if (item.objectId || item.deepLink.startsWith("/objects/")) return "Open place";
  if (item.projectId) return "Open project";
  return "Open";
}
