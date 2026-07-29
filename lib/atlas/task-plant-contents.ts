export type AtlasTaskPlantContent = {
  contentId: string;
  objectId: string;
  objectKey: string;
  objectLabel: string;
  contentLabel: string;
  displayLabel: string;
  variety: string | null;
  contentType: string;
  status: string;
  displayOrder: number;
};

export type AtlasTaskPlantContentsResponse = {
  ok: boolean;
  taskId?: string;
  contents?: AtlasTaskPlantContent[];
  error?: string;
  details?: string;
};

export async function fetchAtlasTaskPlantContents(taskId: string) {
  const response = await fetch(`/api/atlas/task-plant-contents?taskId=${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json() as AtlasTaskPlantContentsResponse;
  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Atlas could not load the plants in this bed.");
  }
  return data.contents ?? [];
}
