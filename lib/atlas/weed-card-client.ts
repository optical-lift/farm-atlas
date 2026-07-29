import type {
  AtlasFinishWeedCardDayInput,
  AtlasFinishWeedCardDayResult,
  AtlasWeedCardSessionInput,
  AtlasWeedCardSessionResult,
} from "@/lib/atlas/weed-card-contract";

function mutationKey(kind: string, taskId: string) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `weed-card:${kind}:${taskId}:${nonce}`;
}

async function readMutationResponse<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json() as T & {
    ok?: boolean;
    error?: string | { message?: string };
    details?: string;
  };

  if (!response.ok || !data.ok) {
    const message = data.details
      || (typeof data.error === "string" ? data.error : data.error?.message)
      || fallback;
    throw new Error(message);
  }

  return data;
}

export async function postAtlasWeedCardSession(
  input: AtlasWeedCardSessionInput,
): Promise<AtlasWeedCardSessionResult> {
  const response = await fetch("/api/atlas/weed-card-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "weed-card-pass-v1",
    },
    cache: "no-store",
    body: JSON.stringify({
      ...input,
      idempotencyKey: input.idempotencyKey || mutationKey("pass", input.taskId),
    }),
  });

  return readMutationResponse<AtlasWeedCardSessionResult>(response, "Weed Card pass failed.");
}

export async function postAtlasFinishPartialWeedCardDay(
  input: AtlasWeedCardSessionInput,
): Promise<AtlasWeedCardSessionResult> {
  const response = await fetch("/api/atlas/weed-card-partial", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "weed-card-partial-v1",
    },
    cache: "no-store",
    body: JSON.stringify({
      ...input,
      idempotencyKey: input.idempotencyKey || mutationKey("partial", input.taskId),
    }),
  });

  return readMutationResponse<AtlasWeedCardSessionResult>(response, "Atlas could not save the partial Weed Card work.");
}

export async function postAtlasFinishWeedCardDay(
  input: AtlasFinishWeedCardDayInput,
): Promise<AtlasFinishWeedCardDayResult> {
  const response = await fetch("/api/atlas/weed-card-day", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "weed-card-day-v1",
    },
    cache: "no-store",
    body: JSON.stringify({
      ...input,
      idempotencyKey: input.idempotencyKey || mutationKey("day", input.taskId),
    }),
  });

  return readMutationResponse<AtlasFinishWeedCardDayResult>(response, "Atlas could not close today's Weed Card.");
}