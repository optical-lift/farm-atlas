export type AtlasInboxResponse = {
  ok: boolean;
  inboxItem?: {
    id: string;
    status: string;
    body: string;
    created_at: string;
  };
  error?: string;
  details?: string;
};

export async function saveAtlasInboxItem(payload: {
  body: string;
  zoneKey?: string | null;
  createdBy?: string;
}): Promise<AtlasInboxResponse> {
  const response = await fetch("/api/atlas/inbox", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as AtlasInboxResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Failed to save Atlas inbox note.");
  }

  return data;
}
