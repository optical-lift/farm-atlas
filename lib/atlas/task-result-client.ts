export type AtlasTaskResult = "done" | "partial" | "changed" | "blocked" | "needs_supplies";

export type AtlasTaskCapture = {
  kind: string;
  standQuality?: string;
  standPercent?: string;
  plantCount?: string;
  gaps?: string;
  nextAction?: string;
  finished?: string;
  pressure?: string;
  stems?: string;
  quality?: string;
  destination?: string;
  actualContents?: string;
  heading?: string;
};

export type AtlasTaskResultResponse = {
  ok: boolean;
  taskId?: string;
  result?: AtlasTaskResult;
  fieldLogId?: string;
  generatedSupplyTaskId?: string | null;
  generatedFollowUpTaskId?: string | null;
  error?: string;
  details?: string;
};

export async function saveAtlasTaskResult(payload: {
  taskId: string;
  result: AtlasTaskResult;
  note?: string;
  createdBy?: string;
  objectId?: string;
  capture?: AtlasTaskCapture;
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
