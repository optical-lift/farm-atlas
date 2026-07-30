type HandoffResponse = {
  ok?: boolean;
  handoffId?: string;
  taskId?: string;
  status?: string;
  message?: string;
  deduplicated?: boolean;
  error?: string | { message?: string };
  details?: string;
};

function idempotencyKey(taskId: string, action: "open" | "resolve") {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `task-problem-handoff:${action}:${taskId}:${nonce}`;
}

function errorMessage(data: HandoffResponse, fallback: string) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  if (data.error?.message) return data.error.message;
  return fallback;
}

async function postHandoff(body: Record<string, unknown>, fallback: string) {
  const response = await fetch("/api/atlas/task-problem-handoff", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "task-problem-handoff-v1",
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const data = await response.json() as HandoffResponse;
  if (!response.ok || !data.ok) throw new Error(errorMessage(data, fallback));
  return data;
}

export function openAtlasTaskProblemHandoff(taskId: string, issueText: string) {
  return postHandoff({
    action: "open",
    taskId,
    issueText,
    idempotencyKey: idempotencyKey(taskId, "open"),
  }, "Atlas could not send this problem to the Owner.");
}

export function resolveAtlasTaskProblemHandoff(taskId: string, ownerResponse: string) {
  return postHandoff({
    action: "resolve",
    taskId,
    ownerResponse,
    idempotencyKey: idempotencyKey(taskId, "resolve"),
  }, "Atlas could not send this task back to Anna.");
}
