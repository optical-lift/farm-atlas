export type AtlasTaskResult = "done" | "partial" | "blocked" | "needs_supplies";

export type AtlasTaskResultResponse = {
  ok: boolean;
  taskId?: string;
  result?: AtlasTaskResult;
  fieldLogId?: string;
  generatedSupplyTaskId?: string | null;
  error?: string;
  details?: string;
};

export async function saveAtlasTaskResult(payload: {
  taskId: string;
  result: AtlasTaskResult;
  note?: string;
  createdBy?: string;
}): Promise<AtlasTaskResultResponse> {
  const response = await fetch("/api/atlas/task-result", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as AtlasTaskResultResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Failed to save task result.");
  }

  return data;
}