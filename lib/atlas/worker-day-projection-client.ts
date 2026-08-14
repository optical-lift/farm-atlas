import type { AtlasDaySequence } from "@/lib/atlas/day-sequence";
import type { AtlasWorkerDayProjection } from "@/lib/atlas/day-projection";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

export type AtlasWorkerDayRuntimeSequence = AtlasDaySequence & {
  availableWorkerDay: boolean;
  operatorLabel: string;
  farmId: string;
  membershipId: string;
  paidTargetMinutes: number;
  committedPaidMinutes: number;
  automaticPaidMinutes: number;
  remainingPaidMinutes: number;
  warnings: string[];
};

type WorkerDaySequenceResponse = {
  ok?: boolean;
  active?: boolean;
  operatorLabel?: string;
  canManage?: boolean;
  projection?: AtlasWorkerDayProjection<AtlasWorkerDayRuntimeSequence> | null;
  taskCards?: AtlasTaskCard[];
};

export type AtlasWorkerDayProjectionRead = {
  projection: AtlasWorkerDayProjection<AtlasWorkerDayRuntimeSequence>;
  operatorLabel: string;
  canManage: boolean;
  taskCards: AtlasTaskCard[];
};

async function readWorkerDaySequenceResponse(dateIso: string) {
  const response = await fetch(`/api/atlas/worker-day-sequence?date=${encodeURIComponent(dateIso)}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = await response.json() as WorkerDaySequenceResponse;
  if (!response.ok || !body.ok || !body.active || !body.projection) return null;
  return {
    projection: body.projection,
    operatorLabel: typeof body.operatorLabel === "string" && body.operatorLabel.trim() ? body.operatorLabel : "Farm Hand",
    canManage: body.canManage === true,
    taskCards: Array.isArray(body.taskCards) ? body.taskCards : [],
  } satisfies AtlasWorkerDayProjectionRead;
}

export async function readOwnerWorkerDayProjection(dateIso: string) {
  const read = await readWorkerDaySequenceResponse(dateIso);
  return read?.canManage ? { projection: read.projection, operatorLabel: read.operatorLabel, taskCards: read.taskCards } : null;
}

export async function readWorkerSelfDayProjection(dateIso: string) {
  const read = await readWorkerDaySequenceResponse(dateIso);
  if (!read || read.canManage) throw new Error("Atlas could not load the Farm Hand Worker Day projection.");
  return { projection: read.projection, operatorLabel: read.operatorLabel, taskCards: read.taskCards };
}

export async function readAtlasWorkerDayProjection(dateIso: string): Promise<AtlasWorkerDayProjectionRead> {
  const read = await readWorkerDaySequenceResponse(dateIso);
  if (!read) throw new Error("Atlas could not load the Worker Day projection.");
  return read;
}
