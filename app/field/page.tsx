"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  getAreaObjectStateSummary,
  type ObjectLiveState,
} from "../../data/atlas/object-state";
import { farms, type FarmId } from "../../data/atlas/farms";
import {
  farmScopedKey,
  getActiveFarmId,
  setActiveFarmId,
} from "../../data/atlas/active-farm";
import { atlasTasksJuneJuly2026 } from "../../data/atlas/atlas-tasks-june-july-2026";
import {
  atlasAreas2026,
  getAtlasAreaLabel,
} from "../../data/atlas/atlas-areas-2026";
import {
  cropProfiles,
  type CropProfileId,
} from "../../data/atlas/crop-profiles";
import {
  deriveClaim,
  getAreaInventorySummary,
} from "../../data/atlas/claim-automation";
import {
  plantingClaims,
  type PlantingClaim,
} from "../../data/atlas/planting-claims";
import {
  getDefaultGrowingObjectForArea,
  getGrowingObject,
  getGrowingObjectLabel,
  getPlantingObjectsForArea,
  getTaskObjectsForArea,
} from "../../data/atlas/growing-objects";
import type {
  AtlasActionType,
  AtlasAreaId,
  AtlasTask,
  AtlasTaskStateMap,
  AtlasTaskStatus,
} from "../../data/atlas/field-types";

const STORAGE_KEY = "atlas-field-mode-v1";
const GENERATED_TASKS_KEY = "atlas-field-mode-generated-tasks-v1";
const PLANTING_CLAIMS_KEY = "atlas-planting-claims-v1";
const FIELD_LOG_KEY = "atlas-field-log-v1";

const actionTypes: AtlasActionType[] = [
  "field_check",
  "direct_sow",
  "seed",
  "transplant",
  "water_check",
  "observe",
  "path",
  "record",
  "move",
  "pot_up",
  "handoff",
];

const claimUnits: PlantingClaim["unit"][] = [
  "full_bed",
  "partial_bed",
  "arch",
  "patch",
  "clump",
];

const workClaimTypes: WorkClaimType[] = [
  "planted",
  "weeded",
  "watered",
  "sprayed",
  "raked",
  "mulched",
  "harvested",
  "observed",
  "cleared",
];

type TaskTab = "today" | "earlier" | "next";

type TaskCue = {
  icon: string;
  label: string;
};
type FieldLogEventType =
  | "claim_added"
  | "claim_deleted"
  | "work_claimed"
  | "task_added"
  | "task_deleted"
  | "task_done"
  | "task_blocked"
  | "task_skipped"
  | "generated_task";

type FieldLogEntry = {
  id: string;
  createdAt: string;
  date: string;
  eventType: FieldLogEventType;
  title: string;
  detail: string;
  areaId?: AtlasAreaId;
  objectId?: string;
  claimId?: string;
  taskId?: string;
};

type WorkClaimType =
  | "planted"
  | "weeded"
  | "watered"
  | "sprayed"
  | "raked"
  | "mulched"
  | "harvested"
  | "observed"
  | "cleared";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function prettyDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function addDaysIso(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function loadState(storageKey: string): AtlasTaskStateMap {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveState(storageKey: string, next: AtlasTaskStateMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(next));
}

function loadGeneratedTasks(generatedTasksKey: string): AtlasTask[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(generatedTasksKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveGeneratedTasks(generatedTasksKey: string, next: AtlasTask[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(generatedTasksKey, JSON.stringify(next));
}

function loadPlantingClaims(storageKey: string): PlantingClaim[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePlantingClaims(storageKey: string, next: PlantingClaim[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(next));
}

function loadFieldLog(storageKey: string): FieldLogEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFieldLog(storageKey: string, next: FieldLogEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(next));
}

function mergeTask(task: AtlasTask, stored: AtlasTaskStateMap): AtlasTask {
  return {
    ...task,
    status: stored[task.id]?.status ?? task.status,
  };
}

function getSafeRequestedArea(requestedArea: string | null): AtlasAreaId | null {
  if (!requestedArea) return null;

  return atlasAreas2026.some((area) => area.id === requestedArea)
    ? (requestedArea as AtlasAreaId)
    : null;
}

function getDefaultObjectIdForArea(areaId: AtlasAreaId) {
  return getDefaultGrowingObjectForArea(areaId)?.id ?? "";
}

function getDefaultTaskObjectIdForArea(areaId: AtlasAreaId) {
  return getTaskObjectsForArea(areaId)[0]?.id ?? "";
}

function getClaimedObjectIds(claims: PlantingClaim[]) {
  return new Set(
    claims
      .filter((claim) => claim.objectId)
      .map((claim) => claim.objectId as string),
  );
}

function getFirstOpenPlantingObjectId(areaId: AtlasAreaId, claims: PlantingClaim[]) {
  const objects = getPlantingObjectsForArea(areaId);
  const claimedObjectIds = getClaimedObjectIds(claims);

  return objects.find((object) => !claimedObjectIds.has(object.id))?.id ?? objects[0]?.id ?? "";
}

function getObjectClaimSummary(objectId: string, claims: PlantingClaim[]) {
  const claim = claims.find((item) => item.objectId === objectId);

  if (!claim) return "open";

  const crop = cropProfiles.find((item) => item.id === claim.cropId);
  return crop?.label ?? "claimed";
}

function getWatchTask(tasks: AtlasTask[], selectedDate: string, primaryId?: string) {
  return tasks.find((task) => {
    const text = `${task.title} ${task.instructions}`.toLowerCase();

    return (
      task.date === selectedDate &&
      task.id !== primaryId &&
      (text.includes("check") ||
        text.includes("germination") ||
        text.includes("water") ||
        text.includes("mark") ||
        task.status === "blocked")
    );
  });
}

function getActionCue(actionType: AtlasActionType): TaskCue {
  switch (actionType) {
    case "direct_sow":
      return { icon: "🌱", label: "Sow" };
    case "seed":
      return { icon: "✦", label: "Start" };
    case "transplant":
      return { icon: "⇄", label: "Plant" };
    case "pot_up":
      return { icon: "◌", label: "Pot up" };
    case "water_check":
      return { icon: "◍", label: "Water" };
    case "field_check":
      return { icon: "👁", label: "Check" };
    case "record":
      return { icon: "✎", label: "Record" };
    case "handoff":
      return { icon: "→", label: "Handoff" };
    case "observe":
      return { icon: "◇", label: "Observe" };
    case "move":
      return { icon: "✓", label: "Move" };
    case "path":
      return { icon: "⌁", label: "Path" };
    default:
      return { icon: "•", label: "Task" };
  }
}

function getDurationCue(task: AtlasTask): TaskCue {
  const text = `${task.title} ${task.instructions}`.toLowerCase();

  if (text.includes("quick") || text.includes("mark") || task.actionType === "observe") {
    return { icon: "◴", label: "5m" };
  }

  if (task.actionType === "water_check" || task.actionType === "field_check") {
    return { icon: "◴", label: "10m" };
  }

  if (task.actionType === "direct_sow" || task.actionType === "seed") {
    return { icon: "◴", label: "20m" };
  }

  if (
    task.actionType === "transplant" ||
    task.actionType === "pot_up" ||
    task.actionType === "move"
  ) {
    return { icon: "◴", label: "45m" };
  }

  if (task.actionType === "path") {
    return { icon: "◴", label: "1h+" };
  }

  return { icon: "◴", label: "15m" };
}

function getPlaceCue(task: AtlasTask): TaskCue {
  const objectLabel = getGrowingObjectLabel(task.objectId);
  const area = getAtlasAreaLabel(task.areaId);

  return { icon: "⌖", label: objectLabel || task.objectId || area };
}

function getSettingCue(task: AtlasTask): TaskCue {
  if (task.areaId === "seed_room" || task.actionType === "pot_up" || task.actionType === "seed") {
    return { icon: "⌂", label: "Inside" };
  }

  if (task.actionType === "record" || task.actionType === "handoff") {
    return { icon: "☉", label: "Desk" };
  }

  return { icon: "☀", label: "Outside" };
}

function getWeightCue(task: AtlasTask): TaskCue {
  const text = `${task.title} ${task.instructions}`.toLowerCase();

  if (text.includes("check") || text.includes("watch") || task.actionType === "field_check") {
    return { icon: "◷", label: "Watch" };
  }

  if (task.status === "blocked") {
    return { icon: "✕", label: "Blocked" };
  }

  return { icon: "✓", label: "Move" };
}

function getTaskCues(task: AtlasTask): TaskCue[] {
  return [
    getActionCue(task.actionType),
    getPlaceCue(task),
    getDurationCue(task),
    getSettingCue(task),
    getWeightCue(task),
  ];
}

function getActionTypeForWorkClaim(workType: WorkClaimType): AtlasActionType {
  switch (workType) {
    case "planted":
      return "direct_sow";
    case "weeded":
      return "field_check";
    case "watered":
      return "water_check";
    case "sprayed":
      return "field_check";
    case "raked":
      return "path";
    case "mulched":
      return "path";
    case "harvested":
      return "record";
    case "observed":
      return "observe";
    case "cleared":
      return "move";
    default:
      return "record";
  }
}

function getWorkClaimTitle(workType: WorkClaimType, placeLabel: string) {
  switch (workType) {
    case "planted":
      return `Planted ${placeLabel}`;
    case "weeded":
      return `Weeded ${placeLabel}`;
    case "watered":
      return `Watered ${placeLabel}`;
    case "sprayed":
      return `Sprayed ${placeLabel}`;
    case "raked":
      return `Raked ${placeLabel}`;
    case "mulched":
      return `Mulched ${placeLabel}`;
    case "harvested":
      return `Harvested ${placeLabel}`;
    case "observed":
      return `Observed ${placeLabel}`;
    case "cleared":
      return `Cleared ${placeLabel}`;
    default:
      return `Worked ${placeLabel}`;
  }
}

function buildFollowupsFromWorkClaim(task: AtlasTask, workType: WorkClaimType): AtlasTask[] {
  const objectLabel = getGrowingObjectLabel(task.objectId);
  const areaLabel = getAtlasAreaLabel(task.areaId);
  const placeLabel = objectLabel ? `${objectLabel} in ${areaLabel}` : areaLabel;

  switch (workType) {
    case "weeded":
      return [
        {
          id: `generated-${task.id}-weed-recheck-${addDaysIso(task.date, 7)}`,
          date: addDaysIso(task.date, 7),
          title: "Recheck weeds",
          areaId: task.areaId,
          objectId: task.objectId,
          actionType: "field_check",
          instructions: `Recheck weeds at ${placeLabel}. This was generated from a claimed weeding pass.`,
          unlockText: "Weeds do not silently reclaim a finished area.",
          status: "open",
        },
      ];

    case "watered":
      return [
        {
          id: `generated-${task.id}-water-recheck-${addDaysIso(task.date, 1)}`,
          date: addDaysIso(task.date, 1),
          title: "Water check",
          areaId: task.areaId,
          objectId: task.objectId,
          actionType: "water_check",
          instructions: `Check moisture at ${placeLabel}. This was generated from a claimed watering pass.`,
          unlockText: "Fresh planting or stressed plants stay alive.",
          status: "open",
        },
      ];

    case "sprayed":
      return [
        {
          id: `generated-${task.id}-spray-recheck-${addDaysIso(task.date, 7)}`,
          date: addDaysIso(task.date, 7),
          title: "Treatment recheck",
          areaId: task.areaId,
          objectId: task.objectId,
          actionType: "field_check",
          instructions: `Recheck treatment effect at ${placeLabel}. Look for dieback, regrowth, and whether the area is safe/ready for the next step.`,
          unlockText: "Chemical/treatment timing does not have to live in memory.",
          status: "open",
        },
      ];

    case "raked":
    case "mulched":
      return [
        {
          id: `generated-${task.id}-path-surface-recheck-${addDaysIso(task.date, 7)}`,
          date: addDaysIso(task.date, 7),
          title: "Recheck surface",
          areaId: task.areaId,
          objectId: task.objectId,
          actionType: "field_check",
          instructions: `Recheck surface condition at ${placeLabel}. Confirm it still reads intentional and usable.`,
          unlockText: "Paths and surfaces stay readable instead of drifting back to rough.",
          status: "open",
        },
      ];

    case "cleared":
      return [
        {
          id: `generated-${task.id}-next-use-decision-${addDaysIso(task.date, 2)}`,
          date: addDaysIso(task.date, 2),
          title: "Next use decision",
          areaId: task.areaId,
          objectId: task.objectId,
          actionType: "record",
          instructions: `Decide the next use for ${placeLabel}: reseed, plant, mulch, rest, or keep clear.`,
          unlockText: "Cleared space does not become accidental weeds again.",
          status: "open",
        },
      ];

    case "observed":
      return [
        {
          id: `generated-${task.id}-observation-followup-${addDaysIso(task.date, 7)}`,
          date: addDaysIso(task.date, 7),
          title: "Observation follow-up",
          areaId: task.areaId,
          objectId: task.objectId,
          actionType: "observe",
          instructions: `Recheck ${placeLabel}. Confirm whether the observation changed the plan.`,
          unlockText: "Observed areas get revisited before they become forgotten uncertainty.",
          status: "open",
        },
      ];

    case "harvested":
      return [
        {
          id: `generated-${task.id}-post-harvest-decision-${addDaysIso(task.date, 2)}`,
          date: addDaysIso(task.date, 2),
          title: "Post-harvest decision",
          areaId: task.areaId,
          objectId: task.objectId,
          actionType: "record",
          instructions: `Record whether ${placeLabel} should keep producing, be cut again, cleared, or succeeded.`,
          unlockText: "Harvest becomes part of the bed story instead of a loose memory.",
          status: "open",
        },
      ];

    case "planted":
    default:
      return [];
  }
}

function isMaintenanceTask(task: AtlasTask) {
  const text = `${task.title} ${task.instructions}`.toLowerCase();

  return (
    text.includes("weed") ||
    text.includes("path") ||
    text.includes("mow") ||
    text.includes("clear") ||
    text.includes("tidy") ||
    text.includes("check") ||
    task.actionType === "field_check" ||
    task.actionType === "observe" ||
    task.actionType === "path" ||
    task.actionType === "water_check"
  );
}

function getMaintenanceFollowupTitle(task: AtlasTask) {
  const text = `${task.title} ${task.instructions}`.toLowerCase();

  if (text.includes("weed")) return "Recheck weeds";
  if (text.includes("path") || task.actionType === "path") return "Recheck path";
  if (text.includes("mow")) return "Recheck mowing edge";
  if (text.includes("water") || task.actionType === "water_check") return "Water check";
  if (text.includes("germination")) return "Germination follow-up";
  return "Follow-up check";
}

function buildMaintenanceFollowupTask(task: AtlasTask): AtlasTask | null {
  if (!isMaintenanceTask(task)) return null;
  if (task.id.includes("-maintenance-followup")) return null;
  if (task.id.includes("claim-task-")) return null;

  const objectLabel = getGrowingObjectLabel(task.objectId);
  const areaLabel = getAtlasAreaLabel(task.areaId);
  const placeLabel = objectLabel ? `${objectLabel} in ${areaLabel}` : areaLabel;
  const title = getMaintenanceFollowupTitle(task);

  return {
    id: `generated-${task.id}-maintenance-followup-${addDaysIso(task.date, 7)}`,
    date: addDaysIso(task.date, 7),
    title,
    areaId: task.areaId,
    objectId: task.objectId,
    actionType: "field_check",
    instructions: `Recheck ${placeLabel}. This was generated because "${task.title}" was marked done.`,
    unlockText: "Maintenance does not silently drift after one pass.",
    status: "open",
  };
}

function buildTasksFromPlantingClaim(claim: PlantingClaim): AtlasTask[] {
  const derived = deriveClaim(claim);
  const cropLabel = derived.crop.label;
  const areaLabel = getAtlasAreaLabel(claim.areaId);
  const objectLabel = derived.objectLabel;
  const placeLabel = objectLabel ? `${objectLabel} in ${areaLabel}` : areaLabel;

  const tasks: AtlasTask[] = [
    {
      id: `claim-task-${claim.id}-water-check`,
      date: addDaysIso(claim.plantedDate, 1),
      title: `Water check: ${cropLabel}`,
      areaId: claim.areaId,
      objectId: claim.objectId,
      actionType: "water_check",
      instructions: `Check moisture where ${cropLabel} was planted in ${placeLabel}. Do not redesign the bed; just keep the claim alive.`,
      unlockText: "Fresh seed stays alive long enough to prove germination.",
      status: "open",
    },
  ];

  if (derived.germinationCheckStart) {
    tasks.push({
      id: `claim-task-${claim.id}-germination-check`,
      date: derived.germinationCheckStart,
      title: `Check germination: ${cropLabel}`,
      areaId: claim.areaId,
      objectId: claim.objectId,
      actionType: "field_check",
      instructions: `Look for emergence in ${placeLabel}. Mark gaps, washout, bird disturbance, or failure early.`,
      unlockText: "Failed rows get caught while reseeding is still possible.",
      status: "open",
    });
  }

  if (derived.harvestStart && derived.revenueEligible) {
    tasks.push({
      id: `claim-task-${claim.id}-harvest-watch`,
      date: derived.harvestStart,
      title: `Harvest watch: ${cropLabel}`,
      areaId: claim.areaId,
      objectId: claim.objectId,
      actionType: "field_check",
      instructions: `Start watching ${placeLabel} for ${cropLabel} harvest readiness. Check stem/usefulness before the window quietly passes.`,
      unlockText: "Planting becomes a real deliverable instead of forgotten biomass.",
      status: "open",
    });
  }

  if (derived.harvestEnd) {
    tasks.push({
      id: `claim-task-${claim.id}-succession-decision`,
      date: derived.harvestEnd,
      title: `Succession decision: ${cropLabel}`,
      areaId: claim.areaId,
      objectId: claim.objectId,
      actionType: "record",
      instructions: `Decide whether to keep, cut, clear, reseed, or hand ${placeLabel} forward. Record what happened.`,
      unlockText: "The next crop window stays visible before the space drifts.",
      status: "open",
    });
  }

  return tasks;
}

function FieldModeInner() {
  const searchParams = useSearchParams();
  const safeRequestedArea = getSafeRequestedArea(searchParams.get("area"));
  const shouldOpenAdd = searchParams.get("add") === "1";

  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [activeFarmId, setActiveFarmIdState] = useState<FarmId>("elm");
  const [stored, setStored] = useState<AtlasTaskStateMap>({});
  const [generatedTasks, setGeneratedTasks] = useState<AtlasTask[]>([]);
  const [savedPlantingClaims, setSavedPlantingClaims] = useState<PlantingClaim[]>([]);
const [fieldLog, setFieldLog] = useState<FieldLogEntry[]>([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showClaimPlanting, setShowClaimPlanting] = useState(false);
  const [activeTab, setActiveTab] = useState<TaskTab>("today");
  const [showHeroDetail, setShowHeroDetail] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newAreaId, setNewAreaId] = useState<AtlasAreaId>("field_rows");
  const [newObjectId, setNewObjectId] = useState(getDefaultTaskObjectIdForArea("field_rows"));
  const [newDate, setNewDate] = useState(todayIso());
  const [newActionType, setNewActionType] = useState<AtlasActionType>("field_check");
  const [newInstructions, setNewInstructions] = useState("");

const [workClaimType, setWorkClaimType] = useState<WorkClaimType>("planted");
  const [claimAreaId, setClaimAreaId] = useState<AtlasAreaId>("field_rows");
  const [claimObjectId, setClaimObjectId] = useState(getDefaultObjectIdForArea("field_rows"));
  const [claimCropId, setClaimCropId] = useState<CropProfileId>("black_oil_sunflower");
  const [claimDate, setClaimDate] = useState(todayIso());
  const [claimUnit, setClaimUnit] = useState<PlantingClaim["unit"]>("full_bed");
  const [claimUnitCount, setClaimUnitCount] = useState(1);
  const [claimNotes, setClaimNotes] = useState("");
const [workClaimNote, setWorkClaimNote] = useState("");

  const storageKey = farmScopedKey(STORAGE_KEY, activeFarmId);
  const generatedTasksKey = farmScopedKey(GENERATED_TASKS_KEY, activeFarmId);
  const plantingClaimsKey = farmScopedKey(PLANTING_CLAIMS_KEY, activeFarmId);
const fieldLogKey = farmScopedKey(FIELD_LOG_KEY, activeFarmId);


  const allPlantingClaims = useMemo(
    () => [...plantingClaims, ...savedPlantingClaims],
    [savedPlantingClaims],
  );

  const plantingObjectsForClaimArea = getPlantingObjectsForArea(claimAreaId);
  const taskObjectsForNewArea = getTaskObjectsForArea(newAreaId);
  const selectedClaimObject = getGrowingObject(claimObjectId);

  useEffect(() => {
    const farmId = getActiveFarmId();

    setActiveFarmIdState(farmId);
    setStored(loadState(farmScopedKey(STORAGE_KEY, farmId)));
    setGeneratedTasks(loadGeneratedTasks(farmScopedKey(GENERATED_TASKS_KEY, farmId)));
    setSavedPlantingClaims(loadPlantingClaims(farmScopedKey(PLANTING_CLAIMS_KEY, farmId)));
setFieldLog(loadFieldLog(farmScopedKey(FIELD_LOG_KEY, farmId)));

    if (safeRequestedArea) {
      const storedClaims = loadPlantingClaims(farmScopedKey(PLANTING_CLAIMS_KEY, farmId));
      const combinedClaims = [...plantingClaims, ...storedClaims];

      setNewAreaId(safeRequestedArea);
      setNewObjectId(getDefaultTaskObjectIdForArea(safeRequestedArea));
      setClaimAreaId(safeRequestedArea);
      setClaimObjectId(getFirstOpenPlantingObjectId(safeRequestedArea, combinedClaims));
    }

    if (shouldOpenAdd) {
      setShowAddTask(true);
    }
  }, [safeRequestedArea, shouldOpenAdd]);

  useEffect(() => {
    setStored(loadState(storageKey));
    setGeneratedTasks(loadGeneratedTasks(generatedTasksKey));
    setSavedPlantingClaims(loadPlantingClaims(plantingClaimsKey));
setFieldLog(loadFieldLog(fieldLogKey));
}, [storageKey, generatedTasksKey, plantingClaimsKey, fieldLogKey]);


  useEffect(() => {
    const allowed = getPlantingObjectsForArea(claimAreaId);

    if (!allowed.some((object) => object.id === claimObjectId)) {
      const nextObjectId = getFirstOpenPlantingObjectId(claimAreaId, allPlantingClaims);
      const nextObject = getGrowingObject(nextObjectId);

      setClaimObjectId(nextObjectId);
      setClaimUnit(nextObject?.defaultClaimUnit ?? "patch");
    }
  }, [claimAreaId, claimObjectId, allPlantingClaims]);

  useEffect(() => {
    const allowed = getTaskObjectsForArea(newAreaId);

    if (!allowed.some((object) => object.id === newObjectId)) {
      setNewObjectId(allowed[0]?.id ?? "");
    }
  }, [newAreaId, newObjectId]);

  const tasks = useMemo(
    () =>
      [...atlasTasksJuneJuly2026, ...generatedTasks]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((task) => mergeTask(task, stored)),
    [stored, generatedTasks],
  );

const visibleTasks = safeRequestedArea
  ? tasks.filter((task) => task.areaId === safeRequestedArea)
  : tasks;

const realToday = todayIso();
const isViewingFutureDate = selectedDate > realToday;

const openVisibleTasks = visibleTasks.filter((task) => task.status === "open");

const overdueOpenTasks = openVisibleTasks
  .filter((task) => task.date < realToday)
  .sort((a, b) => a.date.localeCompare(b.date));

const selectedDateOverdueTasks = openVisibleTasks
  .filter((task) => task.date < selectedDate)
  .sort((a, b) => a.date.localeCompare(b.date));

const todayTasks = visibleTasks
  .filter((task) => task.date === selectedDate)
  .sort((a, b) => {
    if (a.status === "open" && b.status !== "open") return -1;
    if (a.status !== "open" && b.status === "open") return 1;
    return a.title.localeCompare(b.title);
  });

const openTodayTasks = todayTasks.filter((task) => task.status === "open");

const upcomingOpenTasks = openVisibleTasks
  .filter((task) => task.date > selectedDate)
  .sort((a, b) => a.date.localeCompare(b.date));

const realUpcomingOpenTasks = openVisibleTasks
  .filter((task) => task.date >= realToday)
  .sort((a, b) => a.date.localeCompare(b.date));

const primaryTask =
  isViewingFutureDate
    ? openTodayTasks[0] ?? upcomingOpenTasks[0] ?? todayTasks[0]
    : overdueOpenTasks[0] ?? openTodayTasks[0] ?? realUpcomingOpenTasks[0] ?? todayTasks[0];

const primaryTaskMode =
  primaryTask?.status !== "open"
    ? "clear"
    : !isViewingFutureDate && primaryTask.date < realToday
      ? "overdue"
      : primaryTask.date === selectedDate
        ? "today"
        : "next";

const primaryTaskKicker =
  primaryTaskMode === "overdue"
    ? "Overdue"
    : primaryTaskMode === "next"
      ? "Next"
      : "Do";

const primaryTaskSubline =
  primaryTaskMode === "overdue"
    ? `${prettyDate(primaryTask.date)} · ${getAtlasAreaLabel(primaryTask.areaId)}`
    : primaryTaskMode === "next"
      ? `${prettyDate(primaryTask.date)} · ${getAtlasAreaLabel(primaryTask.areaId)}`
      : primaryTask
        ? getAtlasAreaLabel(primaryTask.areaId)
        : "+ Task";

const watchTask = getWatchTask(visibleTasks, selectedDate, primaryTask?.id);

const earlierTasks = isViewingFutureDate
  ? selectedDateOverdueTasks.slice(0, 8)
  : overdueOpenTasks.slice(0, 8);

const nextTasks = upcomingOpenTasks.slice(0, 8);

const tabTasks =
  activeTab === "today"
    ? todayTasks
    : activeTab === "earlier"
      ? earlierTasks
      : nextTasks;

  const openCount = visibleTasks.filter((task) => task.status === "open").length;
  const doneCount = visibleTasks.filter((task) => task.status === "done").length;
  const blockedCount = visibleTasks.filter((task) => task.status === "blocked").length;

  const activeFarm = farms.find((farm) => farm.id === activeFarmId);
  const commandAreaId = safeRequestedArea ?? primaryTask?.areaId ?? claimAreaId;
  const commandAreaSummary = getAreaInventorySummary(commandAreaId, allPlantingClaims);

const commandObjectStateSummary = getAreaObjectStateSummary(
  commandAreaId,
  allPlantingClaims,
  tasks,
  selectedDate,
);

  const claimPreview: PlantingClaim = {
    id: "claim-preview",
    areaId: claimAreaId,
    objectId: claimObjectId || undefined,
    cropId: claimCropId,
    plantedDate: claimDate,
    unit: claimUnit,
    unitCount: claimUnitCount,
    notes: claimNotes,
  };

  const claimPreviewDerived = deriveClaim(claimPreview);

  const recentClaims = useMemo(() => {
    return [...allPlantingClaims]
      .sort((a, b) => b.plantedDate.localeCompare(a.plantedDate) || b.id.localeCompare(a.id))
      .slice(0, 5);
  }, [allPlantingClaims]);

  const recentLocalTasks = useMemo(() => {
    return generatedTasks
      .filter((task) => task.id.startsWith("custom-"))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .slice(0, 5);
  }, [generatedTasks]);

  function handleFarmChange(farmId: FarmId) {
    setActiveFarmId(farmId);
    setActiveFarmIdState(farmId);
    setStored(loadState(farmScopedKey(STORAGE_KEY, farmId)));
    setGeneratedTasks(loadGeneratedTasks(farmScopedKey(GENERATED_TASKS_KEY, farmId)));
    setSavedPlantingClaims(loadPlantingClaims(farmScopedKey(PLANTING_CLAIMS_KEY, farmId)));
  }

function createFieldLogEntry(
  entry: Omit<FieldLogEntry, "id" | "createdAt">,
): FieldLogEntry {
  return {
    ...entry,
    id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
  };
}

function writeFieldLogEntries(entries: FieldLogEntry[]) {
  if (entries.length === 0) return;

  setFieldLog((currentLog) => {
    const nextLog = [...entries, ...currentLog].slice(0, 150);
    saveFieldLog(fieldLogKey, nextLog);
    return nextLog;
  });
}

function makeTaskLogEntry(task: AtlasTask, eventType: FieldLogEventType): FieldLogEntry {
  const objectLabel = getGrowingObjectLabel(task.objectId);
  const areaLabel = getAtlasAreaLabel(task.areaId);
  const placeLabel = objectLabel ? `${objectLabel} · ${areaLabel}` : areaLabel;

  const titleByType: Record<FieldLogEventType, string> = {
    claim_added: "Claim added",
    claim_deleted: "Claim deleted",
    work_claimed: "Work claimed",
    task_added: "Task added",
    task_deleted: "Task deleted",
    task_done: "Task completed",
    task_blocked: "Task blocked",
    task_skipped: "Task skipped",
    generated_task: "Generated task",
  };

  return createFieldLogEntry({
    date: task.date,
    eventType,
    title: titleByType[eventType],
    detail: `${task.title} · ${placeLabel}`,
    areaId: task.areaId,
    objectId: task.objectId,
    taskId: task.id,
  });
}

  function handleClaimAreaChange(areaId: AtlasAreaId) {
    const nextObjectId = getFirstOpenPlantingObjectId(areaId, allPlantingClaims);
    const nextObject = getGrowingObject(nextObjectId);

    setClaimAreaId(areaId);
    setClaimObjectId(nextObjectId);
    setClaimUnit(nextObject?.defaultClaimUnit ?? "patch");
  }

  function handleClaimObjectChange(objectId: string) {
    const object = getGrowingObject(objectId);

    setClaimObjectId(objectId);

    if (object?.defaultClaimUnit) {
      setClaimUnit(object.defaultClaimUnit);
    }
  }

  function handleNewAreaChange(areaId: AtlasAreaId) {
    setNewAreaId(areaId);
    setNewObjectId(getDefaultTaskObjectIdForArea(areaId));
  }

function appendGeneratedTasks(newTasks: AtlasTask[]) {
  if (newTasks.length === 0) return [];

  const existingTaskIds = new Set(generatedTasks.map((task) => task.id));
  const cleanNewTasks = newTasks.filter((task) => !existingTaskIds.has(task.id));

  if (cleanNewTasks.length === 0) return [];

  const nextGeneratedTasks = [...generatedTasks, ...cleanNewTasks].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  setGeneratedTasks(nextGeneratedTasks);
  saveGeneratedTasks(generatedTasksKey, nextGeneratedTasks);

  return cleanNewTasks;
}

function setTaskStatus(task: AtlasTask, status: AtlasTaskStatus) {
  const next = {
    ...stored,
    [task.id]: {
      status,
      updatedAt: new Date().toISOString(),
    },
  };

  setStored(next);
  saveState(storageKey, next);

  const effects =
    status === "done" ? task.ifDone ?? [] : status === "skipped" ? task.ifSkipped ?? [] : [];

  const followupTasks: AtlasTask[] = effects
    .filter((effect) => effect.type === "create_followup_task")
    .map((effect, index) => {
      const followupDate = addDaysIso(task.date, effect.daysAfter);

      return {
        id: `generated-${task.id}-${followupDate}-${index}`,
        date: followupDate,
        title: effect.title,
        areaId: task.areaId,
        objectId: task.objectId,
        actionType: effect.actionType,
        instructions: effect.title,
        unlockText: `Follow-up from ${task.title}.`,
        status: "open",
      };
    });

  const maintenanceFollowup = status === "done" ? buildMaintenanceFollowupTask(task) : null;

  const createdFollowups = appendGeneratedTasks(
    maintenanceFollowup ? [...followupTasks, maintenanceFollowup] : followupTasks,
  );

  const statusEventType: FieldLogEventType =
    status === "done"
      ? "task_done"
      : status === "blocked"
        ? "task_blocked"
        : "task_skipped";

  writeFieldLogEntries([
    makeTaskLogEntry(task, statusEventType),
    ...createdFollowups.map((createdTask) => makeTaskLogEntry(createdTask, "generated_task")),
  ]);
}

  function resetTask(task: AtlasTask) {
    const next = { ...stored };
    delete next[task.id];
    setStored(next);
    saveState(storageKey, next);
  }

function addCustomTask(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();

  if (!newTitle.trim()) return;

  const task: AtlasTask = {
    id: `custom-${Date.now()}`,
    date: newDate,
    title: newTitle.trim(),
    areaId: newAreaId,
    objectId: newObjectId || undefined,
    actionType: newActionType,
    instructions: newInstructions.trim() || `Added for ${getAtlasAreaLabel(newAreaId)}.`,
    unlockText: "Manual task.",
    status: "open",
  };

  const nextGeneratedTasks = [...generatedTasks, task].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  setGeneratedTasks(nextGeneratedTasks);
  saveGeneratedTasks(generatedTasksKey, nextGeneratedTasks);

  writeFieldLogEntries([
    makeTaskLogEntry(task, "task_added"),
  ]);

  setSelectedDate(task.date);
  setActiveTab("today");
  setNewTitle("");
  setNewInstructions("");
  setShowAddTask(false);
}

function deleteGeneratedTask(taskId: string) {
  const taskToDelete = generatedTasks.find((task) => task.id === taskId);

  const nextGeneratedTasks = generatedTasks.filter((task) => task.id !== taskId);
  const nextStored = { ...stored };

  delete nextStored[taskId];

  setGeneratedTasks(nextGeneratedTasks);
  setStored(nextStored);

  saveGeneratedTasks(generatedTasksKey, nextGeneratedTasks);
  saveState(storageKey, nextStored);

  if (taskToDelete) {
    writeFieldLogEntries([makeTaskLogEntry(taskToDelete, "task_deleted")]);
  }
}

function addNonPlantingWorkClaim() {
  const objectLabel = getGrowingObjectLabel(claimObjectId);
  const areaLabel = getAtlasAreaLabel(claimAreaId);
  const placeLabel = objectLabel ?? areaLabel;

  const task: AtlasTask = {
    id: `work-${Date.now()}`,
    date: claimDate,
    title: getWorkClaimTitle(workClaimType, placeLabel),
    areaId: claimAreaId,
    objectId: claimObjectId || undefined,
    actionType: getActionTypeForWorkClaim(workClaimType),
    instructions:
      workClaimNote.trim() ||
      `${workClaimType} was claimed for ${objectLabel ? `${objectLabel} in ${areaLabel}` : areaLabel}.`,
    unlockText: "Claimed field work becomes part of the object history.",
    status: "done",
  };

  const createdFollowups = appendGeneratedTasks([
    task,
    ...buildFollowupsFromWorkClaim(task, workClaimType),
  ]);

  writeFieldLogEntries([
    createFieldLogEntry({
      date: claimDate,
      eventType: "work_claimed",
      title: "Work claimed",
      detail: `${workClaimType} · ${objectLabel ? `${objectLabel} · ${areaLabel}` : areaLabel}`,
      areaId: claimAreaId,
      objectId: claimObjectId || undefined,
      taskId: task.id,
    }),
    ...createdFollowups
      .filter((createdTask) => createdTask.id !== task.id)
      .map((createdTask) => makeTaskLogEntry(createdTask, "generated_task")),
  ]);

  setSelectedDate(claimDate);
  setActiveTab("today");
  setWorkClaimNote("");
  setShowClaimPlanting(false);
}

function addPlantingClaim(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();

  if (workClaimType !== "planted") {
    addNonPlantingWorkClaim();
    return;
  }

  const object = getGrowingObject(claimObjectId);

  const claim: PlantingClaim = {
    id: `claim-${Date.now()}`,
    areaId: claimAreaId,
    objectId: claimObjectId || undefined,
    cropId: claimCropId,
    plantedDate: claimDate,
    unit: claimUnit,
    unitCount: Math.max(0, claimUnitCount),
    notes: claimNotes.trim() || undefined,
  };

  const derivedClaim = deriveClaim(claim);
  const nextClaims = [...savedPlantingClaims, claim];
  const combinedNextClaims = [...plantingClaims, ...nextClaims];

  setSavedPlantingClaims(nextClaims);
  savePlantingClaims(plantingClaimsKey, nextClaims);

  const createdFollowups = appendGeneratedTasks(buildTasksFromPlantingClaim(claim));

  writeFieldLogEntries([
    createFieldLogEntry({
      date: claim.plantedDate,
      eventType: "claim_added",
      title: "Claim added",
      detail: `${derivedClaim.objectLabel ?? getAtlasAreaLabel(claim.areaId)} · ${
        derivedClaim.crop.label
      } · ${derivedClaim.sizeLabel}`,
      areaId: claim.areaId,
      objectId: claim.objectId,
      claimId: claim.id,
    }),
    ...createdFollowups.map((task) => makeTaskLogEntry(task, "generated_task")),
  ]);

  setSelectedDate(claim.plantedDate);
  setActiveTab("next");
  setClaimNotes("");
  setShowClaimPlanting(false);

  if (object?.areaId) {
    const nextOpenObjectId = getFirstOpenPlantingObjectId(object.areaId, combinedNextClaims);
    const nextObject = getGrowingObject(nextOpenObjectId);

    setClaimAreaId(object.areaId);
    setClaimObjectId(nextOpenObjectId);
    setClaimUnit(nextObject?.defaultClaimUnit ?? "patch");
  }
}

function deleteLocalClaim(claimId: string) {
  const claimToDelete = savedPlantingClaims.find((claim) => claim.id === claimId);
  const derivedClaim = claimToDelete ? deriveClaim(claimToDelete) : null;

  const nextClaims = savedPlantingClaims.filter((claim) => claim.id !== claimId);

  const removedGeneratedTaskIds = new Set(
    generatedTasks
      .filter((task) => task.id.includes(`claim-task-${claimId}-`))
      .map((task) => task.id),
  );

  const nextGeneratedTasks = generatedTasks.filter((task) => !removedGeneratedTaskIds.has(task.id));
  const nextStored = { ...stored };

  removedGeneratedTaskIds.forEach((taskId) => {
    delete nextStored[taskId];
  });

  setSavedPlantingClaims(nextClaims);
  setGeneratedTasks(nextGeneratedTasks);
  setStored(nextStored);

  savePlantingClaims(plantingClaimsKey, nextClaims);
  saveGeneratedTasks(generatedTasksKey, nextGeneratedTasks);
  saveState(storageKey, nextStored);

  if (claimToDelete && derivedClaim) {
    writeFieldLogEntries([
      createFieldLogEntry({
        date: todayIso(),
        eventType: "claim_deleted",
        title: "Claim deleted",
        detail: `${derivedClaim.objectLabel ?? getAtlasAreaLabel(claimToDelete.areaId)} · ${
          derivedClaim.crop.label
        }`,
        areaId: claimToDelete.areaId,
        objectId: claimToDelete.objectId,
        claimId: claimToDelete.id,
      }),
    ]);
  }
}

  return (
    <main className="atlas-phone-shell">
      <section className="atlas-phone">
        <header className="atlas-phone-top with-weather">
          <div className="atlas-phone-brand atlas-title-weather">
            <Link href="/" className="atlas-phone-kicker">
              ← Atlas
            </Link>

            <div className="atlas-title-row">
              <strong className="atlas-phone-title">{activeFarm?.label ?? "Farm"}</strong>

              <select
                aria-label="Choose farm"
                className="atlas-farm-inline-select"
                value={activeFarmId}
                onChange={(event) => handleFarmChange(event.target.value as FarmId)}
              >
                {farms.map((farm) => (
                  <option key={farm.id} value={farm.id}>
                    {farm.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="atlas-weather-center">☁ 61°</div>

          <div className="atlas-phone-actions atlas-action-stack">
<button
  type="button"
  className="atlas-top-action atlas-top-action-task"
  onClick={() => {
    handleNewAreaChange(commandAreaId);
    setNewDate(selectedDate);
    setShowAddTask(true);
    setShowClaimPlanting(false);

    window.setTimeout(() => {
      document
        .getElementById("atlas-add-task-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }}
  aria-label="Add task"
  title="Add task"
>
  +
</button>
            <button
              type="button"
              className="atlas-top-action atlas-top-action-planting"
              onClick={() => {
                handleClaimAreaChange(commandAreaId);
                setShowClaimPlanting(true);
                setShowAddTask(false);

                window.setTimeout(() => {
                  document
                    .getElementById("atlas-claim-planting-form")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 50);
              }}
              aria-label="Claim work"
              title="Claim work"
            >
              +
            </button>
          </div>
        </header>

        <div className="atlas-phone-body">
          <section className="atlas-hero-compact">
            <div className="atlas-hero-top">
              <h1 className="atlas-hero-title">Today</h1>

              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="atlas-soft-date"
              />
            </div>

            <div className="atlas-hero-grid">
<button
  type="button"
  className={`atlas-hero-tile atlas-hero-tile-button ${
    primaryTaskMode === "overdue" ? "atlas-hero-tile-overdue" : ""
  }`}
  onClick={() => setShowHeroDetail((value) => !value)}
>
  <span className="atlas-soft-label">{primaryTaskKicker}</span>
  <strong>{primaryTask?.title ?? "No task"}</strong>
  <em>{primaryTaskSubline}</em>
  {primaryTask && <TaskCues task={primaryTask} compact max={2} />}
</button>

              <button
                type="button"
                className="atlas-hero-tile atlas-hero-tile-button"
                onClick={() => setShowHeroDetail(false)}
              >
                <span className="atlas-soft-label">Watch</span>
                <strong>{watchTask?.title ?? "Clear"}</strong>
                <em>{watchTask ? getAtlasAreaLabel(watchTask.areaId) : "No check"}</em>
                {watchTask && <TaskCues task={watchTask} compact max={2} />}
              </button>
            </div>

            {showHeroDetail && primaryTask && (
              <HeroTaskDetail
                task={primaryTask}
                onDone={() => setTaskStatus(primaryTask, "done")}
                onBlocked={() => setTaskStatus(primaryTask, "blocked")}
                onSkipped={() => setTaskStatus(primaryTask, "skipped")}
                onClose={() => setShowHeroDetail(false)}
              />
            )}

            <div className="atlas-hero-stats">
              <div className="atlas-hero-stat">
                <span>Open</span>
                <strong>{openCount}</strong>
              </div>
              <div className="atlas-hero-stat">
                <span>Done</span>
                <strong>{doneCount}</strong>
              </div>
              <div className="atlas-hero-stat">
                <span>Block</span>
                <strong>{blockedCount}</strong>
              </div>
            </div>
          </section>

          <section className="atlas-soft-card compact">
            <div className="atlas-soft-head">
              <div>
                <span className="atlas-phone-kicker">Inventory</span>
                <strong className="atlas-soft-heading">{getAtlasAreaLabel(commandAreaId)}</strong>
              </div>

              <span className="atlas-soft-badge">{commandAreaSummary.plantedBeds} claimed</span>
            </div>

<div className="atlas-zone-mini-stats">
  <span>
    {commandObjectStateSummary.claimedPlantingObjectCount}/
    {commandObjectStateSummary.plantingObjectCount} claimed
  </span>
  <span>{commandObjectStateSummary.openPlantingObjectCount} open</span>
  <span>next open: {commandObjectStateSummary.nextOpenObjectLabel}</span>
  <span>crops: {commandObjectStateSummary.activeCropsLabel}</span>
  <span>next task: {commandObjectStateSummary.nextTaskDateLabel}</span>
  {commandObjectStateSummary.overdueTaskCount > 0 ? (
    <span>{commandObjectStateSummary.overdueTaskCount} overdue</span>
  ) : null}
  <span>{commandAreaSummary.revenueLabel}</span>
</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              <button
                type="button"
                className="atlas-zone-action accent"
                onClick={() => {
                  handleClaimAreaChange(commandAreaId);
                  setShowClaimPlanting((value) => !value);
                  setShowAddTask(false);
                }}
              >
                Claim work
              </button>

<button
  type="button"
  className="atlas-zone-action primary"
  onClick={() => {
    handleNewAreaChange(commandAreaId);
    setNewDate(selectedDate);
    setShowAddTask(true);
    setShowClaimPlanting(false);

    window.setTimeout(() => {
      document
        .getElementById("atlas-add-task-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }}
>
  Add task
</button>
            </div>
          </section>

<LiveObjectsCard objectStates={commandObjectStateSummary.objectStates.slice(0, 8)} />

<RecentClaimsCard
            claims={recentClaims}
            savedClaimIds={new Set(savedPlantingClaims.map((claim) => claim.id))}
            onDeleteClaim={deleteLocalClaim}
          />

          {recentLocalTasks.length > 0 && (
            <RecentTasksCard tasks={recentLocalTasks} onDeleteTask={deleteGeneratedTask} />
          )}

<FieldLogCard entries={fieldLog.slice(0, 12)} />

          <div className="atlas-tab-row">
            <button
              type="button"
              className={`atlas-tab ${activeTab === "today" ? "active" : ""}`}
              onClick={() => setActiveTab("today")}
            >
              Today
            </button>
            <button
              type="button"
              className={`atlas-tab ${activeTab === "earlier" ? "active" : ""}`}
              onClick={() => setActiveTab("earlier")}
            >
              Earlier
            </button>
            <button
              type="button"
              className={`atlas-tab ${activeTab === "next" ? "active" : ""}`}
              onClick={() => setActiveTab("next")}
            >
              Next
            </button>
          </div>

          {showClaimPlanting && (
            <section id="atlas-claim-planting-form" className="atlas-soft-card tight">
              <div className="atlas-soft-head">
                <strong className="atlas-soft-heading">Claim work</strong>

                <button
                  type="button"
                  className="atlas-phone-pill"
                  onClick={() => setShowClaimPlanting(false)}
                >
                  Close
                </button>
              </div>

              <form onSubmit={addPlantingClaim} className="atlas-add-form">

<label>
  <span className="atlas-soft-label">Work</span>
  <select
    value={workClaimType}
    onChange={(event) => setWorkClaimType(event.target.value as WorkClaimType)}
  >
    {workClaimTypes.map((type) => (
      <option key={type} value={type}>
        {type}
      </option>
    ))}
  </select>
</label>
                <label>
                  <span className="atlas-soft-label">Area</span>
                  <select
                    value={claimAreaId}
                    onChange={(event) => handleClaimAreaChange(event.target.value as AtlasAreaId)}
                  >
                    {atlasAreas2026.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="atlas-soft-label">Object / bed</span>
                  <select
                    value={claimObjectId}
                    onChange={(event) => handleClaimObjectChange(event.target.value)}
                  >
                    {plantingObjectsForClaimArea.map((object) => {
                      const claimSummary = getObjectClaimSummary(object.id, allPlantingClaims);
                      const isOpen = claimSummary === "open";

                      return (
                        <option key={object.id} value={object.id}>
                          {object.label} — {isOpen ? "open" : claimSummary}
                        </option>
                      );
                    })}
                  </select>
                </label>
{workClaimType === "planted" ? (
  <>
    <label>
      <span className="atlas-soft-label">Crop</span>
      <select
        value={claimCropId}
        onChange={(event) => setClaimCropId(event.target.value as CropProfileId)}
      >
        {cropProfiles.map((crop) => (
          <option key={crop.id} value={crop.id}>
            {crop.label}
          </option>
        ))}
      </select>
    </label>

    <label>
      <span className="atlas-soft-label">Date planted</span>
      <input
        type="date"
        value={claimDate}
        onChange={(event) => setClaimDate(event.target.value)}
      />
    </label>

    <label>
      <span className="atlas-soft-label">Unit</span>
      <select
        value={claimUnit}
        onChange={(event) => setClaimUnit(event.target.value as PlantingClaim["unit"])}
      >
        {claimUnits.map((unit) => (
          <option key={unit} value={unit}>
            {unit.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>

    <label>
      <span className="atlas-soft-label">Count</span>
      <input
        type="number"
        min="0"
        step="0.25"
        value={claimUnitCount}
        onChange={(event) => setClaimUnitCount(Number(event.target.value))}
      />
    </label>

    <label>
      <span className="atlas-soft-label">Note</span>
      <textarea
        value={claimNotes}
        onChange={(event) => setClaimNotes(event.target.value)}
        placeholder="Example: Earthway sowed after raking; walkway seeded with pasture grass."
      />
    </label>

    <div className="atlas-zone-warning">
      <strong>{claimPreviewDerived.objectLabel ?? getAtlasAreaLabel(claimAreaId)}</strong>
      <br />
      {claimPreviewDerived.sizeLabel} · {claimPreviewDerived.estimatedPlants} plants ·{" "}
      {claimPreviewDerived.revenueLabel} · harvest {claimPreviewDerived.harvestCountdownLabel}
      {selectedClaimObject?.notes ? (
        <>
          <br />
          <br />
          {selectedClaimObject.notes}
        </>
      ) : null}
    </div>

    <button className="atlas-phone-pill primary" style={{ width: "100%" }}>
      Save planting
    </button>
  </>
) : (
  <>
    <label>
      <span className="atlas-soft-label">Date worked</span>
      <input
        type="date"
        value={claimDate}
        onChange={(event) => setClaimDate(event.target.value)}
      />
    </label>

    <label>
      <span className="atlas-soft-label">Note</span>
      <textarea
        value={workClaimNote}
        onChange={(event) => setWorkClaimNote(event.target.value)}
        placeholder="Example: weeded the left arch bed; Bermuda regrowth still visible near edge."
      />
    </label>

    <div className="atlas-zone-warning">
      <strong>{getGrowingObjectLabel(claimObjectId) ?? getAtlasAreaLabel(claimAreaId)}</strong>
      <br />
      Claiming: {workClaimType}
      {selectedClaimObject?.notes ? (
        <>
          <br />
          <br />
          {selectedClaimObject.notes}
        </>
      ) : null}
    </div>

    <button className="atlas-phone-pill primary" style={{ width: "100%" }}>
      Save work
    </button>
  </>
)}
            </form>
            </section>
          )}

          {showAddTask && (
            <section id="atlas-add-task-form" className="atlas-soft-card tight">
              <div className="atlas-soft-head">
                <strong className="atlas-soft-heading">Add task</strong>

                <button
                  type="button"
                  className="atlas-phone-pill"
                  onClick={() => setShowAddTask(false)}
                >
                  Close
                </button>
              </div>

              <form onSubmit={addCustomTask} className="atlas-add-form">
                <label>
                  <span className="atlas-soft-label">Task</span>
                  <input
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    placeholder="Weed Curve Arch Set 2 Left Bed"
                  />
                </label>

                <label>
                  <span className="atlas-soft-label">Area</span>
                  <select
                    value={newAreaId}
                    onChange={(event) => handleNewAreaChange(event.target.value as AtlasAreaId)}
                  >
                    {atlasAreas2026.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="atlas-soft-label">Object / bed</span>
                  <select
                    value={newObjectId}
                    onChange={(event) => setNewObjectId(event.target.value)}
                  >
                    {taskObjectsForNewArea.map((object) => (
                      <option key={object.id} value={object.id}>
                        {object.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="atlas-soft-label">Date</span>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(event) => setNewDate(event.target.value)}
                  />
                </label>

                <label>
                  <span className="atlas-soft-label">Type</span>
                  <select
                    value={newActionType}
                    onChange={(event) => setNewActionType(event.target.value as AtlasActionType)}
                  >
                    {actionTypes.map((action) => (
                      <option key={action} value={action}>
                        {action.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="atlas-soft-label">Note</span>
                  <textarea
                    value={newInstructions}
                    onChange={(event) => setNewInstructions(event.target.value)}
                    placeholder="What needs to happen?"
                  />
                </label>

                <button className="atlas-phone-pill primary" style={{ width: "100%" }}>
                  Save task
                </button>
              </form>
            </section>
          )}

          <section className="atlas-task-list">
            {tabTasks.length > 0 ? (
              tabTasks.map((task) => (
                <TaskWorkCard
                  key={task.id}
                  task={task}
                  storedState={stored[task.id]}
                  isPrimary={task.id === primaryTask?.id && activeTab === "today"}
                  onDone={() => setTaskStatus(task, "done")}
                  onBlocked={() => setTaskStatus(task, "blocked")}
                  onSkipped={() => setTaskStatus(task, "skipped")}
                  onReset={() => resetTask(task)}
                />
              ))
            ) : (
              <div className="atlas-empty">None</div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

type LiveObjectsCardProps = {
  objectStates: ObjectLiveState[];
};

function FieldLogCard({ entries }: { entries: FieldLogEntry[] }) {
  const eventLabel: Record<FieldLogEventType, string> = {
    claim_added: "claim",
    claim_deleted: "claim removed",
    task_added: "task",
    work_claimed: "work",
    task_deleted: "task removed",
    task_done: "done",
    task_blocked: "blocked",
    task_skipped: "skipped",
    generated_task: "follow-up",
  };

  return (
    <section className="atlas-soft-card compact">
      <div className="atlas-soft-head">
        <div>
          <span className="atlas-phone-kicker">Field</span>
          <strong className="atlas-soft-heading">Log</strong>
        </div>

        <span className="atlas-soft-badge">{entries.length} events</span>
      </div>

      {entries.length === 0 ? (
        <div className="atlas-empty" style={{ marginTop: 10 }}>
          No log entries yet. Add a task, mark a task done, or claim a planting.
        </div>
      ) : (
        <div className="atlas-field-log-list">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className={`atlas-field-log-item atlas-field-log-item-${entry.eventType}`}
            >
              <div className="atlas-field-log-main">
                <strong>{entry.title}</strong>

                <span>
                  {prettyDate(entry.date)} · {entry.detail}
                </span>
              </div>

              <div className="atlas-field-log-meta">
                <span>{eventLabel[entry.eventType]}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function LiveObjectsCard(props: LiveObjectsCardProps) {
  const { objectStates } = props;

  if (objectStates.length === 0) return null;

  return (
    <section className="atlas-soft-card compact">
      <div className="atlas-soft-head">
        <div>
          <span className="atlas-phone-kicker">Live state</span>
          <strong className="atlas-soft-heading">Objects</strong>
        </div>
      </div>

      <div className="atlas-live-object-list">
        {objectStates.map((object) => (
          <article
            key={object.objectId}
            className={`atlas-live-object ${object.isClaimed ? "claimed" : "open"}`}
          >
            <div className="atlas-live-object-head">
              <strong>{object.label}</strong>
              <span>{object.isClaimed ? "claimed" : "open"}</span>
            </div>

            <p>{object.detailLabel}</p>

            <div className="atlas-live-object-meta">
              <span>{object.stateLabel}</span>
              <span>next: {object.nextTaskDateLabel}</span>
              {object.overdueTaskCount > 0 ? (
                <span>{object.overdueTaskCount} overdue</span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RecentClaimsCard({
  claims,
  savedClaimIds,
  onDeleteClaim,
}: {
  claims: PlantingClaim[];
  savedClaimIds: Set<string>;
  onDeleteClaim: (claimId: string) => void;
}) {
  if (claims.length === 0) return null;

  return (
    <section className="atlas-soft-card compact">
      <div className="atlas-soft-head">
        <div>
          <span className="atlas-phone-kicker">Recent</span>
          <strong className="atlas-soft-heading">Claims</strong>
        </div>
      </div>

      <div className="atlas-recent-list">
        {claims.map((claim) => {
          const derived = deriveClaim(claim);
          const canDelete = savedClaimIds.has(claim.id);

          return (
            <article className="atlas-recent-item" key={claim.id}>
              {canDelete ? (
                <button
                  type="button"
                  className="atlas-recent-x"
                  onClick={() => onDeleteClaim(claim.id)}
                  aria-label={`Delete ${derived.objectLabel ?? "claim"}`}
                  title="Delete claim"
                >
                  ×
                </button>
              ) : (
                <span className="atlas-recent-seed">seed</span>
              )}

              <div className="atlas-recent-main">
                <strong>{derived.objectLabel ?? getAtlasAreaLabel(claim.areaId)}</strong>

                <span>
                  {derived.crop.label} · {prettyDate(claim.plantedDate)}
                </span>
              </div>

              <div className="atlas-recent-meta">
                <span>{derived.sizeLabel}</span>
                <span>{derived.revenueLabel}</span>
                <span>harvest {derived.harvestCountdownLabel}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RecentTasksCard({
  tasks,
  onDeleteTask,
}: {
  tasks: AtlasTask[];
  onDeleteTask: (taskId: string) => void;
}) {
  return (
    <section className="atlas-soft-card compact">
      <div className="atlas-soft-head">
        <div>
          <span className="atlas-phone-kicker">Recent</span>
          <strong className="atlas-soft-heading">Added tasks</strong>
        </div>
      </div>

      <div className="atlas-recent-list">
        {tasks.map((task) => (
          <article className="atlas-recent-item" key={task.id}>
            <button
              type="button"
              className="atlas-recent-x"
              onClick={() => onDeleteTask(task.id)}
              aria-label={`Delete ${task.title}`}
              title="Delete task"
            >
              ×
            </button>

            <div className="atlas-recent-main">
              <strong>{task.title}</strong>

              <span>
                {getGrowingObjectLabel(task.objectId) ?? getAtlasAreaLabel(task.areaId)} ·{" "}
                {prettyDate(task.date)}
              </span>
            </div>

            <div className="atlas-recent-meta">
              <span>{task.actionType.replaceAll("_", " ")}</span>
              <span>{task.status}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HeroTaskDetail({
  task,
  onDone,
  onBlocked,
  onSkipped,
  onClose,
}: {
  task: AtlasTask;
  onDone: () => void;
  onBlocked: () => void;
  onSkipped: () => void;
  onClose: () => void;
}) {
  return (
    <div className="atlas-hero-detail">
      <div className="atlas-hero-detail-title">{task.title}</div>

      <TaskCues task={task} compact />

      <div className="atlas-detail-grid">
        <div className="atlas-detail-row">
          <span>When</span>
          <strong>
            {prettyDate(task.date)} · {getDurationCue(task).label}
          </strong>
        </div>

        <div className="atlas-detail-row">
          <span>Where</span>
          <strong>{getPlaceCue(task).label}</strong>
        </div>

        <div className="atlas-detail-row">
          <span>How</span>
          <strong>{task.instructions}</strong>
        </div>

        <div className="atlas-detail-row">
          <span>Why</span>
          <strong>{task.unlockText}</strong>
        </div>
      </div>

      <div className="atlas-hero-icon-actions">
        <button type="button" className="atlas-hero-icon-tap" onClick={onDone} aria-label="Done">
          ✓
        </button>

        <button
          type="button"
          className="atlas-hero-icon-tap"
          onClick={onBlocked}
          aria-label="Block"
        >
          ✕
        </button>

        <button type="button" className="atlas-hero-icon-tap" onClick={onSkipped} aria-label="Skip">
          ↷
        </button>

        <button type="button" className="atlas-hero-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function TaskCues({
  task,
  compact = false,
  max,
}: {
  task: AtlasTask;
  compact?: boolean;
  max?: number;
}) {
  const cues = typeof max === "number" ? getTaskCues(task).slice(0, max) : getTaskCues(task);

  return (
    <div className={`atlas-cue-row ${compact ? "compact" : ""}`}>
      {cues.map((cue) => (
        <span className="atlas-cue" key={`${task.id}-${cue.icon}-${cue.label}`}>
          <span className="atlas-cue-icon">{cue.icon}</span>
          <span className="atlas-cue-label">{cue.label}</span>
        </span>
      ))}
    </div>
  );
}

function TaskIconActions({
  onDone,
  onBlocked,
  onSkipped,
  onReset,
  showReset,
}: {
  onDone: () => void;
  onBlocked: () => void;
  onSkipped: () => void;
  onReset: () => void;
  showReset?: boolean;
}) {
  return (
    <div className="atlas-icon-actions">
      <button
        type="button"
        className="atlas-icon-tap"
        onClick={onDone}
        aria-label="Done"
        title="Done"
      >
        ✓
      </button>

      <button
        type="button"
        className="atlas-icon-tap"
        onClick={onBlocked}
        aria-label="Block"
        title="Block"
      >
        ✕
      </button>

      <button
        type="button"
        className="atlas-icon-tap"
        onClick={onSkipped}
        aria-label="Skip"
        title="Skip"
      >
        ↷
      </button>

      {showReset ? (
        <button type="button" className="atlas-reset-link" onClick={onReset}>
          Reset
        </button>
      ) : null}
    </div>
  );
}

function TaskWorkCard({
  task,
  storedState,
  isPrimary,
  onDone,
  onBlocked,
  onSkipped,
  onReset,
}: {
  task: AtlasTask;
  storedState?: AtlasTaskStateMap[string];
  isPrimary?: boolean;
  onDone: () => void;
  onBlocked: () => void;
  onSkipped: () => void;
  onReset: () => void;
}) {
  return (
    <article className="atlas-primary-card">
      <div className="atlas-primary-top">
        <div>
          <span className="atlas-phone-kicker">{isPrimary ? "Now" : prettyDate(task.date)}</span>
          <h2 className="atlas-primary-title">{task.title}</h2>
        </div>

        <span className="atlas-primary-status">{task.status}</span>
      </div>

      <TaskCues task={task} />

      <p className="atlas-primary-text">{task.instructions}</p>

      <TaskIconActions
        onDone={onDone}
        onBlocked={onBlocked}
        onSkipped={onSkipped}
        onReset={onReset}
        showReset={Boolean(storedState)}
      />
    </article>
  );
}

export default function AtlasFieldModePage() {
  return (
    <Suspense fallback={<main className="atlas-phone-shell">Loading Atlas…</main>}>
      <FieldModeInner />
    </Suspense>
  );
}