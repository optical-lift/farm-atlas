export type GrowRoomZone = {
  zoneId: string;
  zoneKey: string;
  label: string;
};

export type GrowRoomObject = {
  objectId: string;
  objectKey: string;
  label: string;
  objectType: string;
  objectMode: string | null;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export type GrowRoomRelationship = {
  relationshipId: string;
  parentObjectId: string;
  childObjectId: string;
  relationshipType: "contains" | "adjacent" | "destination" | string;
  positionLabel: string | null;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export type GrowRoomBatch = {
  batchId: string;
  productionLotId: string;
  batchNumber: number;
  batchLabel: string;
  containerKind: string;
  blockSizeIn: number | null;
  trayCount: number;
  seedsSown: number;
  seedUnit: string;
  status: string;
  sownDate: string | null;
  expectedGerminationStart: string | null;
  expectedGerminationEnd: string | null;
  germinatedDate: string | null;
  viableSeedlings: number | null;
  currentQuantity: number | null;
  currentUnit: string | null;
  actionRequired: boolean;
  actionKey: string | null;
  actionDueDate: string | null;
  actionNote: string | null;
  lastObservedAt: string | null;
  lastActionAt: string | null;
  destinationObjectId: string | null;
  cropLabel: string;
  variety: string | null;
  lotLabel: string;
  lotStage: string;
  lotLifecycleStatus: string;
  expectedTransplantStart: string | null;
  expectedTransplantEnd: string | null;
  expectedHarvestStart: string | null;
  expectedHarvestEnd: string | null;
  locationObjectId: string | null;
  locationLabel: string | null;
  positionLabel: string | null;
  metadata: Record<string, unknown>;
};

export type GrowRoomAction = {
  taskId: string;
  title: string;
  taskType: string;
  actionKey: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  zoneLabel: string | null;
  batchId: string | null;
  batchLabel: string | null;
  metadata: Record<string, unknown>;
};

export type GrowRoomVisitTask = {
  taskId: string;
  title: string;
  dueDate: string | null;
  status: string;
};

export type GrowRoomState = {
  farmId: string;
  zone: GrowRoomZone | null;
  objects: GrowRoomObject[];
  relationships: GrowRoomRelationship[];
  batches: GrowRoomBatch[];
  actions: GrowRoomAction[];
  visitTask: GrowRoomVisitTask | null;
  rules?: {
    wateringLogged?: boolean;
    ordinaryCareIsHabit?: boolean;
    onlyActionBearingChangesAreRecorded?: boolean;
  };
};

export type GrowRoomTrailNode = {
  key: string;
  label: string;
  state: "complete" | "current" | "future" | "blocked";
};

const stageOrder = [
  "seed_reserved",
  "sown",
  "germination_pending",
  "stand_counted",
  "seedling_care",
  "pot_up",
  "hardening",
  "transplant_ready",
  "transplanted",
  "established",
  "harvest",
] as const;

const stageLabels: Record<(typeof stageOrder)[number], string> = {
  seed_reserved: "Seed",
  sown: "Sown",
  germination_pending: "Germinating",
  stand_counted: "Live stand",
  seedling_care: "Growing",
  pot_up: "Pot up",
  hardening: "Harden",
  transplant_ready: "Ready",
  transplanted: "Plant out",
  established: "Established",
  harvest: "Harvest",
};

function currentStage(batch: GrowRoomBatch): (typeof stageOrder)[number] {
  if (batch.status === "failed") return "germination_pending";
  if (batch.status === "germination_pending") return "germination_pending";
  if (batch.status === "germinated") return "stand_counted";
  if (batch.status === "pot_up_needed") return "pot_up";
  if (batch.status === "hardening") return "hardening";
  if (batch.status === "transplant_ready") return "transplant_ready";
  if (batch.status === "transplanted" || batch.status === "closed") return "transplanted";
  return "seedling_care";
}

export function growRoomBatchTrail(batch: GrowRoomBatch): GrowRoomTrailNode[] {
  const current = currentStage(batch);
  const currentIndex = stageOrder.indexOf(current);
  return stageOrder.slice(1).map((key, indexWithoutSeed) => {
    const index = indexWithoutSeed + 1;
    if (batch.status === "failed" && key === "germination_pending") {
      return { key, label: "Failed", state: "blocked" as const };
    }
    if (index < currentIndex) return { key, label: stageLabels[key], state: "complete" as const };
    if (index === currentIndex) return { key, label: stageLabels[key], state: "current" as const };
    return { key, label: stageLabels[key], state: "future" as const };
  });
}

export function growRoomActionLabel(actionKey: string | null) {
  const labels: Record<string, string> = {
    stand_counted: "Count live stand",
    germination_failed: "Record failed germination",
    replacement_requested: "Replace failed batch",
    replacement_decision: "Decide replacement",
    re_sow: "Re-sow batch",
    mark_pot_up_needed: "Mark for pot-up",
    pot_up: "Pot up",
    pot_up_completed: "Pot-up complete",
    hardening_started: "Start hardening",
    hardening_advanced: "Advance hardening",
    ready_to_transplant: "Mark ready",
    transplant: "Plant out",
    transplanted: "Record plant-out",
    count_adjusted: "Correct live count",
    moved: "Move batch",
    closed: "Close batch",
  };
  return actionKey ? labels[actionKey] ?? actionKey.replaceAll("_", " ") : "No action due";
}

export function isGrowRoomStructuralObject(object: GrowRoomObject) {
  const joined = `${object.objectType} ${object.objectMode ?? ""} ${object.objectKey}`.toLowerCase();
  return /rack|shelf|seed_room|grow_room/.test(joined);
}

export function isRoutineWaterAction(actionKey: string | null) {
  return ["water", "watered", "watering", "moisture_check"].includes((actionKey ?? "").toLowerCase());
}
