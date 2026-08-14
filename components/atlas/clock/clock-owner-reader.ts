import type { AtlasWorkerDayProjection } from "@/lib/atlas/day-projection";

type OwnerSequenceResponse = {
  ok?: boolean;
  active?: boolean;
  projection?: AtlasWorkerDayProjection | null;
};

export async function readOwnerClockProjection(dateIso: string) {
  const response = await fetch(`/api/atlas/worker-day-sequence?date=${encodeURIComponent(dateIso)}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = await response.json() as OwnerSequenceResponse;
  return body.ok && body.active && body.projection ? body.projection : null;
}
