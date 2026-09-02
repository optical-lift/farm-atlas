import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
type RpcError = { code?: string; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_EVENTS = new Set(["handoff_complete", "service_complete", "failed", "note"]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function privateJson(body: Json, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Write-Path": "operational-route-event-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This stop is not assigned to you." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "This route stop no longer exists." }, 404);
  if (["22023", "22P02", "23514"].includes(error.code || "")) return privateJson({ ok: false, error: error.message || "Atlas rejected that route result." }, 400);
  console.error("Operational route event failed.", error);
  return privateJson({ ok: false, error: "Atlas could not save that route result." }, 500);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Route results require a same-origin Atlas request." }, 403);
  }

  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in to record route work." }, 401);

  let body: Json;
  try {
    body = await request.json() as Json;
  } catch {
    return privateJson({ ok: false, error: "A JSON route result is required." }, 400);
  }

  const stopId = clean(body.stopId);
  const eventKind = clean(body.eventKind);
  const note = clean(body.note) || null;
  const idempotencyKey = clean(body.idempotencyKey);
  if (!UUID.test(stopId)) return privateJson({ ok: false, error: "A valid route stop is required." }, 400);
  if (!WORKER_EVENTS.has(eventKind)) return privateJson({ ok: false, error: "That route result is not available here." }, 400);
  if ((eventKind === "failed" || eventKind === "note") && !note) return privateJson({ ok: false, error: "Add a note for that route result." }, 400);
  if (!idempotencyKey || idempotencyKey.length > 160) return privateJson({ ok: false, error: "A valid idempotency key is required." }, 400);

  const supabase = await createAtlasServerClient();
  const result = await supabase.rpc("record_operational_route_stop_event_v1", {
    p_stop_id: stopId,
    p_event_kind: eventKind,
    p_note: note,
    p_payload: { source: "worker_route" },
    p_idempotency_key: idempotencyKey,
  });
  if (result.error) return rpcFailure(result.error as RpcError);
  return privateJson({ ...(result.data as Json), ok: true });
}
