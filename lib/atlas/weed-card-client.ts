import type {
  AtlasWeedCardSessionInput,
  AtlasWeedCardSessionResult,
} from "@/lib/atlas/weed-card-contract";

function sessionKey(taskId: string) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `weed-card:${taskId}:${nonce}`;
}

export async function postAtlasWeedCardSession(
  input: AtlasWeedCardSessionInput,
): Promise<AtlasWeedCardSessionResult> {
  const response = await fetch("/api/atlas/weed-card-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "weed-card-session-v1",
    },
    cache: "no-store",
    body: JSON.stringify({
      ...input,
      idempotencyKey: input.idempotencyKey || sessionKey(input.taskId),
    }),
  });

  const data = await response.json() as AtlasWeedCardSessionResult & {
    ok?: boolean;
    error?: string | { message?: string };
    details?: string;
  };

  if (!response.ok || !data.ok) {
    const message = data.details
      || (typeof data.error === "string" ? data.error : data.error?.message)
      || "Weed Card session failed.";
    throw new Error(message);
  }

  return data;
}
