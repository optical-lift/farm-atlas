import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasMetaString, atlasMetadataValue, atlasTaskDisplay } from "@/lib/atlas/task-display";

export type AtlasWorkCollectionKey = "mowing" | "weeding" | "germination";
export type AtlasWorkCollectionDueMode = "exact" | "through";

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
  weeding: "Weeding",
  germination: "Germination",
};

const collectionHrefs: Record<AtlasWorkCollectionKey, string> = {
  mowing: "/collections/mowing",
  weeding: "/collections/weeding",
  germination: "/collections/germination",
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

function isGerminationTask(task: AtlasTaskCard) {
  const title = task.title.toLowerCase();
  return task.action_key === "germination_check"
    || atlasMetaString(task, "task_style") === "germination_check"
    || atlasMetaString(task, "milestone") === "germination_check"
    || title.includes("germination")
    || title.includes("germinate?");
}

export function atlasWorkCollectionKey(task: AtlasTaskCard): AtlasWorkCollectionKey | null {
  const explicit = atlasMetaString(task, "work_collection_key");
  if (explicit === "mowing" || explicit === "weeding" || explicit === "germination") return explicit;
  if (isGerminationTask(task)) return "germination";
  return null;
}

export function atlasCollectionMemberKey(task: AtlasTaskCard) {
  if (atlasWorkCollectionKey(task) === "germination") {
    return atlasMetaString(task, "crop_cycle_id")
      || atlasMetaString(task, "source_sowing_task_id")
      || task.generated_from_id
      || task.task_id;
  }
  return atlasMetaString(task, "collection_member_key") || task.task_id;
}

export function atlasCollectionPhysicalKey(task: AtlasTaskCard) {
  const objectIds = (task.objects ?? []).map((object) => object.object_id).filter(Boolean).sort();
  if (atlasWorkCollectionKey(task) === "germination") {
    return `germination:${atlasCollectionMemberKey(task)}:${objectIds.join(",")}`;
  }
  if (objectIds.length) return `objects:${objectIds.join(",")}`;
  return `member:${atlasCollectionMemberKey(task)}`;
}

export function atlasIsWorkCollectionMember(task: AtlasTaskCard) {
  return Boolean(atlasWorkCollectionKey(task));
}

export function atlasIsMowingCollectionMember(task: AtlasTaskCard) {
  return atlasWorkCollectionKey(task) === "mowing";
}

export function atlasIsWeedingCollectionMember(task: AtlasTaskCard) {
  return atlasWorkCollectionKey(task) === "weeding";
}

export function atlasIsGerminationCollectionMember(task: AtlasTaskCard) {
  return atlasWorkCollectionKey(task) === "germination";
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

function isActiveCollectionTask(task: AtlasTaskCard) {
  return task.status === "open" || task.status === "blocked";
}

function canonicalCollectionRank(task: AtlasTaskCard) {
  if (task.generated_from === "maintenance_weeding_collection" || task.generated_from === "maintenance_mowing_collection") return 0;
  if (task.generated_from === "crop_cycle_milestone" && atlasWorkCollectionKey(task) === "germination") return 0;
  if (atlasMetaString(task, "maintenance_object_id")) return 1;
  if (task.generated_from === "germination_workflow") return 1;
  return 2;
}

function preferredCollectionTask(current: AtlasTaskCard, candidate: AtlasTaskCard) {
  const currentActive = isActiveCollectionTask(current);
  const candidateActive = isActiveCollectionTask(candidate);
  if (candidateActive !== currentActive) return candidateActive ? candidate : current;

  if (candidateActive && currentActive) {
    const rankDifference = canonicalCollectionRank(candidate) - canonicalCollectionRank(current);
    if (rankDifference !== 0) return rankDifference < 0 ? candidate : current;
    return atlasCollectionTaskSortValue(candidate).localeCompare(atlasCollectionTaskSortValue(current)) < 0 ? candidate : current;
  }

  const candidateUpdated = candidate.updated_at || candidate.created_at || "";
  const currentUpdated = current.updated_at || current.created_at || "";
  return candidateUpdated > currentUpdated ? candidate : current;
}

export function atlasVisibleCollectionTasks(tasks: AtlasTaskCard[]) {
  const members = tasks
    .filter((task) => task.status !== "archived")
    .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b)));

  const byPhysicalObject = new Map<string, AtlasTaskCard>();
  for (const task of members) {
    const key = atlasCollectionPhysicalKey(task);
    const current = byPhysicalObject.get(key);
    byPhysicalObject.set(key, current ? preferredCollectionTask(current, task) : task);
  }

  return Array.from(byPhysicalObject.values())
    .sort((a, b) => atlasCollectionTaskSortValue(a).localeCompare(atlasCollectionTaskSortValue(b)));
}

export function atlasBuildWorkCollectionSummary(
  key: AtlasWorkCollectionKey,
  tasks: AtlasTaskCard[],
  anchorIso: string,
  dueMode: AtlasWorkCollectionDueMode = "exact",
): AtlasWorkCollectionSummary | null {
  const members = atlasVisibleCollectionTasks(tasks.filter((task) => atlasWorkCollectionKey(task) === key));
  if (!members.length) return null;

  const active = members.filter((task) => task.status === "open" || task.status === "blocked");
  const due = active.filter((task) => {
    if (!task.due_date) return dueMode === "through";
    return dueMode === "through" ? task.due_date <= anchorIso : task.due_date === anchorIso;
  });
  const blocked = active.filter((task) => task.status === "blocked");
  const notReady = members.filter(atlasIsNotReadyCollectionTask);
  const doneRecent = members.filter(atlasIsDoneTask);
  const nextDue = active
    .map((task) => task.due_date || atlasMetaString(task, "next_due_at"))
    .filter((value): value is string => Boolean(value && value >= anchorIso))
    .sort()[0];
  const previewTasks = [...due.filter((task) => !atlasIsNotReadyCollectionTask(task)), ...active]
    .filter((task, index, array) => array.findIndex((candidate) => candidate.task_id === task.task_id) === index)
    .slice(0, 3)
    .map((task) => atlasTaskDisplay(task).subject);

  const restingCopy = key === "weeding" ? "weeded" : key === "mowing" ? "mowed" : "checked";
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
    preview: previewTasks.length ? previewTasks.join(" · ") : doneRecent.length ? `Recently ${restingCopy} records are resting` : "No active records",
    tasks: members,
  };
}

export function atlasBuildMowingCollectionSummary(
  tasks: AtlasTaskCard[],
  anchorIso: string,
  dueMode: AtlasWorkCollectionDueMode = "exact",
) {
  return atlasBuildWorkCollectionSummary("mowing", tasks, anchorIso, dueMode);
}

export function atlasBuildWeedingCollectionSummary(
  tasks: AtlasTaskCard[],
  anchorIso: string,
  dueMode: AtlasWorkCollectionDueMode = "exact",
) {
  return atlasBuildWorkCollectionSummary("weeding", tasks, anchorIso, dueMode);
}

export function atlasBuildGerminationCollectionSummary(
  tasks: AtlasTaskCard[],
  anchorIso: string,
  dueMode: AtlasWorkCollectionDueMode = "exact",
) {
  return atlasBuildWorkCollectionSummary("germination", tasks, anchorIso, dueMode);
}
