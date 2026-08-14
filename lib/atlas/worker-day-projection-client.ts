import type { AtlasWorkerDayProjection } from "@/lib/atlas/day-projection";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type WorkerDaySequenceResponse = {
  ok?: boolean;
  active?: boolean;
  canManage?: boolean;
  projection?: AtlasWorkerDayProjection | null;
  taskCards?: AtlasTaskCard[];
};

export type AtlasWorkerDayProjectionRead = {
  projection: AtlasWorkerDayProjection;
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
    canManage: body.canManage === true,
    taskCards: Array.isArray(body.taskCards) ? body.taskCards : [],
  } satisfies AtlasWorkerDayProjectionRead;
}

export async function readOwnerWorkerDayProjection(dateIso: string) {
  const read = await readWorkerDaySequenceResponse(dateIso);
  return read?.canManage ? { projection: read.projection, taskCards: read.taskCards } : null;
}

export async function readWorkerSelfDayProjection(dateIso: string) {
  const read = await readWorkerDaySequenceResponse(dateIso);
  if (!read || read.canManage) throw new Error("Atlas could not load the Farm Hand Worker Day projection.");
  return { projection: read.projection, taskCards: read.taskCards };
}

export async function readAtlasWorkerDayProjection(dateIso: string): Promise<AtlasWorkerDayProjectionRead> {
  const read = await readWorkerDaySequenceResponse(dateIso);
  if (!read) throw new Error("Atlas could not load the Worker Day projection.");
  return read;
}
