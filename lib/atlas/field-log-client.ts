export type CreateAtlasFieldLogInput = {
  actionTypes: string[];
  summarySentence: string;
  note?: string;
  createdBy?: string;
  zoneKeys?: string[];
  objectKeys?: string[];
};

export type AtlasFieldLogResponse = {
  ok: boolean;
  fieldLog?: {
    id: string;
    log_date: string;
    action_types: string[];
    summary_sentence: string;
    note: string | null;
  };
  error?: string;
  details?: string;
};

export async function createAtlasFieldLog(
  input: CreateAtlasFieldLogInput,
): Promise<AtlasFieldLogResponse> {
  const response = await fetch("/api/atlas/field-log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(input),
  });

  const data = (await response.json()) as AtlasFieldLogResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Failed to create Atlas field log.");
  }

  return data;
}