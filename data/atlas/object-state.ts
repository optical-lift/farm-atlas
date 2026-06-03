import type { AtlasAreaId, AtlasTask } from "./field-types";
import { getCropProfile } from "./crop-profiles";
import { deriveClaim } from "./claim-automation";
import type { PlantingClaim } from "./planting-claims";
import {
  getGrowingObject,
  getGrowingObjectsForArea,
  getPlantingObjectsForArea,
  type GrowingObject,
} from "./growing-objects";

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

function sortByDateAsc<T extends { date: string }>(items: T[]) {
  return [...items].sort((a, b) => a.date.localeCompare(b.date));
}

function sortClaimsNewestFirst(claims: PlantingClaim[]) {
  return [...claims].sort(
    (a, b) => b.plantedDate.localeCompare(a.plantedDate) || b.id.localeCompare(a.id),
  );
}

function getObjectClaims(objectId: string, claims: PlantingClaim[]) {
  return sortClaimsNewestFirst(claims.filter((claim) => claim.objectId === objectId));
}

function getObjectTasks(objectId: string, tasks: AtlasTask[]) {
  return tasks.filter((task) => task.objectId === objectId);
}

function getOpenObjectTasks(objectId: string, tasks: AtlasTask[]) {
  return sortByDateAsc(getObjectTasks(objectId, tasks).filter((task) => task.status === "open"));
}

function getNextOpenTaskForObject(objectId: string, tasks: AtlasTask[], today = todayIso()) {
  const openTasks = getOpenObjectTasks(objectId, tasks);

  return (
    openTasks.find((task) => task.date >= today) ??
    openTasks[0] ??
    null
  );
}

function getOverdueOpenTasksForObject(objectId: string, tasks: AtlasTask[], today = todayIso()) {
  return getOpenObjectTasks(objectId, tasks).filter((task) => task.date < today);
}

function getLatestCompletedTaskForObject(objectId: string, tasks: AtlasTask[]) {
  return [...getObjectTasks(objectId, tasks)]
    .filter((task) => task.status === "done")
    .sort((a, b) => b.date.localeCompare(a.date))
    [0] ?? null;
}

function getStateFromObjectKind(object: GrowingObject) {
  switch (object.kind) {
    case "production_bed":
      return "open production bed";
    case "suppression_bed":
      return "suppression/open";
    case "tight_row_block":
      return "visual block";
    case "garden_quadrant":
      return "fullness watch";
    case "center_space":
      return "path / seating watch";
    case "perennial_strip":
      return "perennial watch";
    case "raised_arch_bed":
      return "arch bed";
    case "salvage_area":
      return "salvage watch";
    case "walkway":
      return "path watch";
    case "general_area":
      return "general area";
    default:
      return "open";
  }
}

function getObjectRecommendation(object: GrowingObject) {
  switch (object.kind) {
    case "production_bed":
      return "plant simple production crop";
    case "suppression_bed":
      return "use cheap bold suppression crop";
    case "tight_row_block":
      return "keep visual and intentional";
    case "garden_quadrant":
      return "track fullness, weeds, and path shape";
    case "center_space":
      return "keep walkable and guest-ready";
    case "perennial_strip":
      return "weed and protect perennial fullness";
    case "raised_arch_bed":
      return "track vines, weeds, and arch structure";
    case "salvage_area":
      return "observe and salvage before reset";
    case "walkway":
      return "keep passable";
    case "general_area":
      return "record what changed";
    default:
      return "record current condition";
  }
}

export type ObjectLiveState = {
  objectId: string;
  areaId: AtlasAreaId;
  label: string;
  shortLabel: string;
  kind: GrowingObject["kind"];
  plantingEligible: boolean;
  revenueEligible: boolean;

  isClaimed: boolean;
  isOpenForPlanting: boolean;

  stateLabel: string;
  detailLabel: string;
  recommendationLabel: string;

  cropLabel: string;
  claimDateLabel: string;
  sizeLabel: string;
  revenueLabel: string;
  harvestLabel: string;

  nextTaskId: string | null;
  nextTaskLabel: string;
  nextTaskDateLabel: string;
  nextTaskIsOverdue: boolean;

  overdueTaskCount: number;
  latestDoneLabel: string;
};

export type AreaObjectStateSummary = {
  areaId: AtlasAreaId;
  totalObjects: number;
  plantingObjectCount: number;
  claimedPlantingObjectCount: number;
  openPlantingObjectCount: number;
  nextOpenObjectId: string | null;
  nextOpenObjectLabel: string;
  activeCropsLabel: string;
  nextTaskLabel: string;
  nextTaskDateLabel: string;
  overdueTaskCount: number;
  objectStates: ObjectLiveState[];
};

export function getObjectLiveState(
  objectId: string,
  claims: PlantingClaim[],
  tasks: AtlasTask[],
  today = todayIso(),
): ObjectLiveState | null {
  const object = getGrowingObject(objectId);

  if (!object) return null;

  const objectClaims = getObjectClaims(objectId, claims);
  const latestClaim = objectClaims[0] ?? null;
  const latestDerivedClaim = latestClaim ? deriveClaim(latestClaim, today) : null;
  const crop = latestClaim ? getCropProfile(latestClaim.cropId) : null;

  const nextTask = getNextOpenTaskForObject(objectId, tasks, today);
  const overdueTasks = getOverdueOpenTasksForObject(objectId, tasks, today);
  const latestDoneTask = getLatestCompletedTaskForObject(objectId, tasks);

  const isClaimed = Boolean(latestClaim);
  const isOpenForPlanting = object.plantingEligible && !isClaimed;

  const stateLabel = latestClaim
    ? latestDerivedClaim?.revenueEligible
      ? "planted / production watch"
      : "claimed / maintenance watch"
    : latestDoneTask
      ? "recently worked"
      : getStateFromObjectKind(object);

  const detailLabel = latestClaim
    ? `${crop?.label ?? "claimed"} · ${prettyDate(latestClaim.plantedDate)}`
    : latestDoneTask
      ? `${latestDoneTask.title} · ${prettyDate(latestDoneTask.date)}`
      : object.notes;

  return {
    objectId: object.id,
    areaId: object.areaId,
    label: object.label,
    shortLabel: object.shortLabel,
    kind: object.kind,
    plantingEligible: object.plantingEligible,
    revenueEligible: object.revenueEligible,

    isClaimed,
    isOpenForPlanting,

    stateLabel,
    detailLabel,
    recommendationLabel: getObjectRecommendation(object),

    cropLabel: crop?.label ?? "none",
    claimDateLabel: latestClaim ? prettyDate(latestClaim.plantedDate) : "not claimed",
    sizeLabel: latestDerivedClaim?.sizeLabel ?? "no fixed size",
    revenueLabel: latestDerivedClaim?.revenueLabel ?? "not revenue-tracked",
    harvestLabel: latestDerivedClaim?.harvestCountdownLabel ?? "not dated",

    nextTaskId: nextTask?.id ?? null,
    nextTaskLabel: nextTask?.title ?? "no open task",
    nextTaskDateLabel: nextTask ? prettyDate(nextTask.date) : "not scheduled",
    nextTaskIsOverdue: nextTask ? nextTask.date < today : false,

    overdueTaskCount: overdueTasks.length,
    latestDoneLabel: latestDoneTask
      ? `${latestDoneTask.title} · ${prettyDate(latestDoneTask.date)}`
      : "none",
  };
}

export function getAreaObjectStateSummary(
  areaId: AtlasAreaId,
  claims: PlantingClaim[],
  tasks: AtlasTask[],
  today = todayIso(),
): AreaObjectStateSummary {
  const objects = getGrowingObjectsForArea(areaId);
  const plantingObjects = getPlantingObjectsForArea(areaId);

  const objectStates = objects
    .map((object) => getObjectLiveState(object.id, claims, tasks, today))
    .filter((state): state is ObjectLiveState => Boolean(state));

  const plantingObjectStates = objectStates.filter((state) => state.plantingEligible);
  const claimedPlantingObjectStates = plantingObjectStates.filter((state) => state.isClaimed);
  const openPlantingObjectStates = plantingObjectStates.filter((state) => state.isOpenForPlanting);

  const areaOpenTasks = sortByDateAsc(
    tasks.filter((task) => task.areaId === areaId && task.status === "open"),
  );

  const overdueTasks = areaOpenTasks.filter((task) => task.date < today);
  const nextTask = areaOpenTasks.find((task) => task.date >= today) ?? areaOpenTasks[0] ?? null;

  const activeCrops = Array.from(
    new Set(
      claims
        .filter((claim) => claim.areaId === areaId)
        .map((claim) => getCropProfile(claim.cropId).label),
    ),
  );

  const nextOpenObject = openPlantingObjectStates[0] ?? null;

  return {
    areaId,
    totalObjects: objects.length,
    plantingObjectCount: plantingObjects.length,
    claimedPlantingObjectCount: claimedPlantingObjectStates.length,
    openPlantingObjectCount: openPlantingObjectStates.length,
    nextOpenObjectId: nextOpenObject?.objectId ?? null,
    nextOpenObjectLabel: nextOpenObject?.label ?? "none open",
    activeCropsLabel: activeCrops.length ? activeCrops.join(" · ") : "none claimed",
    nextTaskLabel: nextTask?.title ?? "no open task",
    nextTaskDateLabel: nextTask ? prettyDate(nextTask.date) : "not scheduled",
    overdueTaskCount: overdueTasks.length,
    objectStates,
  };
}