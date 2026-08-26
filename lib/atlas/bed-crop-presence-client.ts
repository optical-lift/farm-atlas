type CropPresenceResult = {
  objectId: string;
  objectKey: string;
  objectLabel: string;
  cropCycleId: string;
  cropLabel: string;
  observedDate: string;
  createdCycle: boolean;
  replayed: boolean;
};

type CropPresenceResponse = {
  ok?: boolean;
  result?: CropPresenceResult;
  error?: string;
  details?: string;
};

export async function recordAtlasObservedCropPresence(input: {
  objectKey: string;
  cropLabel: string;
  observedDate: string;
  note?: string;
  idempotencyKey: string;
}) {
  const response = await fetch(`/api/atlas/objects/${encodeURIComponent(input.objectKey)}/crop-presence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-atlas-intent": "crop-presence-v1",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as CropPresenceResponse;
  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(payload.details || payload.error || "Atlas could not add this crop to the bed.");
  }
  return payload.result;
}