import type { AtlasWorkerActivityDay, AtlasWorkerActivityWriteResult } from "@/lib/atlas/worker-activity-contract";

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: { message?: string } | string };
    if (typeof body.error === "string" && body.error) return body.error;
    if (body.error && typeof body.error === "object" && body.error.message) return body.error.message;
  } catch {
    // Keep the caller's stable fallback when a proxy or connection error returns non-JSON.
  }
  return fallback;
}

export async function fetchWorkerActivityDay(input: {
  farmId: string;
  membershipId: string;
  date: string;
}) {
  const query = new URLSearchParams({
    farmId: input.farmId,
    membershipId: input.membershipId,
    date: input.date,
  });
  const response = await fetch(`/api/atlas/worker-activity?${query.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readError(response, "Atlas could not load today's activity."));
  const body = await response.json() as { ok?: boolean; day?: AtlasWorkerActivityDay };
  if (!body.ok || !body.day) throw new Error("Atlas could not load today's activity.");
  return body.day;
}

export async function postWorkerActivity(input: {
  farmId: string;
  logDate: string;
  rawText: string;
  idempotencyKey: string;
}) {
  const response = await fetch("/api/atlas/worker-activity", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readError(response, "Atlas could not save this work log."));
  const body = await response.json() as { ok?: boolean; result?: AtlasWorkerActivityWriteResult };
  if (!body.ok || !body.result) throw new Error("Atlas could not confirm this work log.");
  return body.result;
}

export async function deleteWorkerActivity(activityLogId: string) {
  const response = await fetch("/api/atlas/worker-activity", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ activityLogId }),
  });
  if (!response.ok) throw new Error(await readError(response, "Atlas could not undo this work log."));
}
