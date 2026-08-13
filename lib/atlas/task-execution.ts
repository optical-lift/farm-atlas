import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  atlasActionForTask,
  atlasMetaString,
  atlasRouteKeyForTask,
  atlasStringList,
  atlasTaskLocation,
  atlasTaskSubject,
} from "@/lib/atlas/task-display";

export type AtlasTaskExecutionModel = {
  doText: string;
  placeText: string;
  howLines: string[];
  doneWhen: string;
  details: string | null;
  dueLabel: string;
};

function prettyDate(value: string | null | undefined) {
  if (!value) return "Open date";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dueLabel(task: AtlasTaskCard) {
  if (!task.due_date) return "Open date";
  const date = new Date(`${task.due_date.slice(0, 10)}T12:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const days = Number.isNaN(date.getTime()) ? null : Math.round((date.getTime() - today.getTime()) / 86400000);
  const label = prettyDate(task.due_date);
  if (days === 0) return `Today · ${label}`;
  if (days === 1) return `Tomorrow · ${label}`;
  return `Due ${label}`;
}

function metadataLines(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return atlasStringList(value);
}

function firstSentence(value: string | null | undefined) {
  if (!value?.trim()) return "";
  const normalized = value.trim().replace(/\s+/g, " ");
  const match = normalized.match(/^.*?[.!?](?:\s|$)/);
  return (match?.[0] || normalized).trim();
}

function physicalZone(task: AtlasTaskCard) {
  if (task.zone_label?.trim()) return task.zone_label.trim();
  const collection = atlasMetaString(task, "collection_zone");
  if (!collection) return "";
  const normalized = collection.toLowerCase();
  if (["network", "owner", "marshall", "anna", "kids", "children", "farm team", "farm_team"].includes(normalized)) return "";
  return collection;
}

function combinedPlace(task: AtlasTaskCard) {
  const explicit = atlasMetaString(task, "execution_place")
    || atlasMetaString(task, "display_location")
    || atlasTaskLocation(task);
  const zone = physicalZone(task);
  if (!zone) return explicit || "Elm Farm";
  if (!explicit || explicit === "Elm Farm") return zone;
  if (explicit.toLowerCase().includes(zone.toLowerCase())) return explicit;
  return `${zone} · ${explicit}`;
}

function fallbackHow(task: AtlasTaskCard) {
  const lines: string[] = [];
  const spacing = atlasStringList(task.metadata?.plant_spacing_lines);
  if (spacing.length) lines.push(spacing.join(" · "));

  const detail = atlasMetaString(task, "display_detail");
  const location = atlasMetaString(task, "display_location");
  if (detail && detail.toLowerCase() !== location.toLowerCase() && !lines.includes(detail)) lines.push(detail);

  if (!lines.length) {
    const noteLead = firstSentence(task.note);
    if (noteLead) lines.push(noteLead);
  }

  // No instructions is meaningful. Do not manufacture a Steps section that points
  // the worker back to instructions which do not exist.
  return lines.slice(0, 2);
}

function fallbackDoneWhen(task: AtlasTaskCard) {
  const route = atlasRouteKeyForTask(task);
  const checklistCompletion = atlasMetaString(task, "execution_checklist_completion_label");
  if (checklistCompletion) return checklistCompletion;

  const explicitTarget = atlasMetaString(task, "completion_condition")
    || atlasMetaString(task, "done_condition")
    || atlasMetaString(task, "condition_target");
  if (explicitTarget) return explicitTarget;

  if (route === "weed") return "The assigned area is cleared to the task target.";
  if (route === "plant") return "The assigned planting is in place.";
  if (route === "seed") return "The assigned bed or area is sown.";
  if (route === "mow") return "The assigned mowing route is cut.";
  if (route === "crop_cycle") return "The requested crop observation is recorded.";
  if (route === "harvest") return "The assigned harvest is finished.";
  if (route === "water") return "The assigned watering is finished.";
  if (route === "propagation") return "The propagation move is finished.";
  if (route === "build") return "The requested build or prep work is finished.";
  if (route === "venue") return "The requested venue work is finished.";
  return "The requested result is recorded.";
}

export function taskExecutionModel(task: AtlasTaskCard): AtlasTaskExecutionModel {
  const action = atlasMetaString(task, "display_action") || atlasActionForTask(task);
  const subject = atlasMetaString(task, "display_subject") || atlasTaskSubject(task);
  const doText = atlasMetaString(task, "execution_do") || [action, subject].filter(Boolean).join(" · ");
  const explicitHow = metadataLines(task, "execution_how");
  const howLines = explicitHow.length ? explicitHow : fallbackHow(task);
  const doneWhen = atlasMetaString(task, "execution_done_when") || fallbackDoneWhen(task);
  const explicitDetails = atlasMetaString(task, "execution_details");
  const note = task.note?.trim() || "";
  const details = explicitDetails || (note && !howLines.some((line) => line === note) ? note : "") || null;

  return {
    doText,
    placeText: combinedPlace(task),
    howLines,
    doneWhen,
    details,
    dueLabel: dueLabel(task),
  };
}
