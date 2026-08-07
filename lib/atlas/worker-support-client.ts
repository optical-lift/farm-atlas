export type AtlasWorkerSupportResult = {
  eventId?: string;
  workerMembershipId?: string;
  taskId?: string;
  mode?: "normal" | "recovery";
  recoveryMovesRemaining?: number;
};

export async function reportAtlasNeedLighterWork(taskId: string) {
  const response = await fetch("/api/atlas/worker-support", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "worker-support-v1",
    },
    cache: "no-store",
    body: JSON.stringify({ action: "need_lighter_work", taskId }),
  });

  const data = await response.json() as {
    ok?: boolean;
    result?: AtlasWorkerSupportResult;
    error?: string;
    message?: string;
  };
  if (!response.ok || !data.ok) {
    throw new Error(data.message || data.error || "Atlas could not adjust the work stream.");
  }
  return data.result ?? {};
}
