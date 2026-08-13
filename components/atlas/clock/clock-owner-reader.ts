import type { AtlasDaySequence } from "@/lib/atlas/day-sequence";

type OwnerSequenceResponse = { ok?: boolean; active?: boolean; sequence?: AtlasDaySequence | null };

export async function readOwnerClockSequence(dateIso: string) {
  const response = await fetch(`/api/atlas/worker-day-sequence?date=${encodeURIComponent(dateIso)}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = await response.json() as OwnerSequenceResponse;
  return body.ok && body.active && body.sequence ? body.sequence : null;
}
