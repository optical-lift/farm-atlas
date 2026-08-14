import { readWorkerSelfDayProjection } from "@/lib/atlas/worker-day-projection-client";

export async function readWorkerClockProjection(dateIso: string) {
  return readWorkerSelfDayProjection(dateIso);
}

// Compatibility seam for callers that still need the sequence while reads move into AtlasRuntime.
export async function readWorkerClockSequence(dateIso: string) {
  const read = await readWorkerClockProjection(dateIso);
  return read.projection.sequence;
}
