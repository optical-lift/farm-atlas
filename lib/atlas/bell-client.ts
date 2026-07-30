import type { AtlasBell, AtlasBellAction } from "@/lib/atlas/bell-contract";

type BellResponse = {
  ok: boolean;
  bell?: AtlasBell;
  error?: string | { message?: string };
};

function errorMessage(response: BellResponse, fallback: string) {
  if (typeof response.error === "string") return response.error;
  return response.error?.message || fallback;
}

export async function fetchAtlasBell(limit = 40): Promise<AtlasBell> {
  const response = await fetch(`/api/atlas/bell?limit=${encodeURIComponent(String(limit))}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const body = await response.json() as BellResponse;
  if (!response.ok || !body.ok || !body.bell) {
    throw new Error(errorMessage(body, "The Bell could not be loaded."));
  }
  return body.bell;
}

export async function updateAtlasBell(input: {
  action: AtlasBellAction;
  eventId?: string;
  seenThrough?: string;
}) {
  const response = await fetch("/api/atlas/bell", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Atlas-Intent": "bell-state-v1",
    },
    body: JSON.stringify(input),
  });
  const body = await response.json() as BellResponse;
  if (!response.ok || !body.ok) {
    throw new Error(errorMessage(body, "The Bell update could not be saved."));
  }
  return body;
}
