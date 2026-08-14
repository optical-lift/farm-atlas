import { readOwnerWorkerDayProjection } from "@/lib/atlas/worker-day-projection-client";

export async function readOwnerClockProjection(dateIso: string) {
  return readOwnerWorkerDayProjection(dateIso);
}

// Compatibility seam for older Clock consumers while reads move into AtlasRuntime.
export async function readOwnerClockSequence(dateIso: string) {
  const projection = await readOwnerClockProjection(dateIso);
  return projection?.sequence ?? null;
}
