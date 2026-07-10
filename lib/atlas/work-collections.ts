import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasMetaString, atlasMetadataValue, atlasTaskDisplay } from "@/lib/atlas/task-display";

export type AtlasWorkCollectionKey = "mowing";

export type AtlasWorkCollectionSummary = {
  key: AtlasWorkCollectionKey;
  label: string;
  href: string;
  dueCount: number;
  openCount: number;
  doneRecentCount: number;
  blockedCount: number;
  notReadyCount: number;
  nextDueLabel: string;
  preview: string;
  tasks: AtlasTaskCard[];
};

const collectionLabels: Record<AtlasWorkCollectionKey, string> = {
  mowing: "Mowing",
};

const collectionHrefs: Record<AtlasWorkCollectionKey, string> = {
  mowing: "/collections/mowing",
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateFromIso(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`);
}

function prettyShortDate(dateIso: string | null | undefined) {
  if (!dateIso) return "open";
  const date = dateFromIso(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function metaNumber(task: AtlasTaskCard, key: string) {
  const value = atlasMetadataValue(task, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 999;
}

export function atlasWorkCollectionKey(task: AtlasTaskCard): AtlasWorkCollectionKey | null {
  const explicit = atlasMetaString(task, "work_collection_key");
  if (explicit === "mowing") return explicit;
  return null;
}

export function atlasIsWorkCollectionMember(task: AtlasTaskCard) {
  return Boolean(atlasWorkCollectionKey(task));
}

export function atlasIsMowingCollectionMember(task: AtlasTaskCard) {
  return atlasWorkCollectionKey(task) === "mowing";
}

export function atlasCollectionTaskSortValue(task: AtlasTaskCard) {
  return `${task.due_date ?? atlasMetaString(task, "next_due_at") ?? "9999-12-31"}-${String(metaNumber(task, "day_order")).padStart(5, "0")}-${atlasTaskDisplay(task).title}`;
}

export function atlasIsDoneTask(task: AtlasTaskCard) {
  return task.status === "done" || task.task_outcomes?.[0]?.outcome === "done" || atlasMetaString(task, "checklist_status") === "done";
}

export function atlasIsNotReadyCollectionTask(task: AtlasTaskCard) {
  const state = text(atlasMetadataValue(task, "collection_state")).toLowerCase();
  return state === "not_ready" || Boolean(atlasMetaString(task, "not_ready_reason"));
}

export function atlasBuildWorkCollectionSummary(
  key: AtlasWorkCollectionKey,
  tasks: AtlasTaskCard[],
  anchorIso: string,
): AtlasWorkCollectionSummary | null {
  const members = tasks
    .filter((task) => atlasWorkCollectionKey(task) === key)
    .filter((task) => task.status !== "archived")
    .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b)));

  if (!members.length) return null;

  const active = members.filter((task) => task.status === "open" || task.status === "blocked");
  const due = active.filter((task) => !task.due_date || task.due_date <= anchorIso);
  const blocked = active.filter((task) => task.status === "blocked");
  const notReady = members.filter(atlasIsNotReadyCollectionTask);
  const doneRecent = members.filter(atlasIsDoneTask);
  const nextDue = members
    .map((task) => atlasMetaString(task, "next_due_at") || task.due_date)
    .filter((value): value is string => Boolean(value && value >= anchorIso))
    .sort()[0];
  const previewTasks = [...due.filter((task) => !atlasIsNotReadyCollectionTask(task)), ...active]
    .filter((task, index, array) => array.findIndex((candidate) => candidate.task_id === task.task_id) === index)
    .slice(0, 3)
    .map((task) => atlasTaskDisplay(task).subject);

  return {
    key,
    label: collectionLabels[key],
    href: collectionHrefs[key],
    dueCount: due.filter((task) => !atlasIsNotReadyCollectionTask(task)).length,
    openCount: active.length,
    doneRecentCount: doneRecent.length,
    blockedCount: blocked.length,
    notReadyCount: notReady.length,
    nextDueLabel: nextDue ? prettyShortDate(nextDue) : "not scheduled",
    preview: previewTasks.length ? previewTasks.join(" · ") : doneRecent.length ? "Recently mowed areas are resting" : "No active areas",
    tasks: members,
  };
}

export function atlasBuildMowingCollectionSummary(tasks: AtlasTaskCard[], anchorIso: string) {
  return atlasBuildWorkCollectionSummary("mowing", tasks, anchorIso);
}
