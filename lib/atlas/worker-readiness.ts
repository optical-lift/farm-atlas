export type JsonObject = Record<string, unknown>;

export type WorkerReadinessPresentation = {
  title: string;
  body: string;
  detail: string | null;
  kind: "prerequisite" | "battery_charge" | "equipment" | "waiting";
};

export type WorkerReadinessResource = {
  resourceKey: string | null;
  resourceLabel: string | null;
  resourceStatus: string | null;
  readinessState: string | null;
  requirementStatus: string | null;
  requirementReady: boolean | null;
};

export type WorkerReadinessResponse = {
  ok: boolean;
  executable?: boolean;
  presentation?: WorkerReadinessPresentation | null;
  resources?: WorkerReadinessResource[];
  error?: string;
};

export function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(object).filter((row): row is JsonObject => Boolean(row)) : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function nullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function readinessResources(readiness: JsonObject): WorkerReadinessResource[] {
  const consequenceGate = object(readiness.stateConsequenceGate);
  const requirements = rows(consequenceGate?.resourceRequirements ?? readiness.resourceRequirements);
  return requirements.map((requirement) => ({
    resourceKey: nullableText(requirement.resourceKey),
    resourceLabel: nullableText(requirement.resourceLabel),
    resourceStatus: nullableText(requirement.resourceStatus),
    readinessState: nullableText(requirement.readinessState),
    requirementStatus: nullableText(requirement.requirementStatus ?? requirement.status),
    requirementReady: nullableBoolean(requirement.requirementReady),
  }));
}

export function workerReadinessPresentation(readiness: JsonObject): WorkerReadinessPresentation {
  if (readiness.prerequisitesReady === false) {
    return {
      title: "Not ready yet",
      body: "This job is waiting on another job to be finished first.",
      detail: "Atlas will make it available when that work is done.",
      kind: "prerequisite",
    };
  }

  const consequenceGate = object(readiness.stateConsequenceGate);
  const requirements = rows(consequenceGate?.resourceRequirements ?? readiness.resourceRequirements);
  const blockingConsequences = rows(consequenceGate?.blockingConsequences ?? readiness.blockingConsequences);

  const battery = requirements.find((requirement) => text(requirement.resourceKey) === "battery_push_mower_battery_set");
  const batteryState = text(battery?.readinessState || battery?.resourceStatus || battery?.status);
  if (battery && ["needs_charge", "charging"].includes(batteryState)) {
    return {
      title: "Not ready yet",
      body: "The mower batteries need to be charged before this job can start.",
      detail: "Charge them and tap Charged in the reminder. Then this job will be ready.",
      kind: "battery_charge",
    };
  }

  const managementEquipmentBlock = blockingConsequences.some((entry) => {
    const consequence = object(entry.consequence);
    return text(entry.audience) === "farm_operations_management"
      || text(consequence?.audience) === "farm_operations_management"
      || text(entry.resourceStatus) === "needs_repair"
      || text(consequence?.resourceStatus) === "needs_repair";
  });

  if (managementEquipmentBlock || readiness.resourcesReady === false) {
    return {
      title: "Not ready yet",
      body: "This job is waiting on equipment.",
      detail: "Nothing you need to do here right now.",
      kind: "equipment",
    };
  }

  return {
    title: "Not ready yet",
    body: "This job can’t be done yet.",
    detail: "Atlas will make it available when the thing it is waiting on is ready.",
    kind: "waiting",
  };
}

export function normalizeWorkerReadiness(data: unknown): WorkerReadinessResponse {
  const readiness = object(data);
  if (!readiness) {
    return { ok: false, error: "Task readiness returned an invalid result." };
  }

  const executable = readiness.ready === true;
  return {
    ok: true,
    executable,
    presentation: executable ? null : workerReadinessPresentation(readiness),
    resources: readinessResources(readiness),
  };
}
