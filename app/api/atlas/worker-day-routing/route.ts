import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ROUTING_MODES = new Set(["ready", "keep_moving", "make_simple", "light_physical"]);

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "worker_day_routing_forbidden", error.message || "This routing action is not available.");
  if (error.code === "22023") return atlasApiError(400, "invalid_worker_day_routing_mode", "That work style is not available.");
  return atlasApiError(500, "worker_day_routing_failed", "Atlas could not adjust today's work style.");
}

export async function GET() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  if (authorized.access.membership.role !== "farm_hand") return atlasApiError(403, "farm_hand_required", "This work-style control is for the active farm hand.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_day_routing_state_v1");
  if (error) return rpcFailure(error);
  return privateJson({ ok: true, state: data });
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "worker-day-routing-v1") {
    return atlasApiError(400, "worker_day_routing_intent_required", "A valid work-style intent is required.");
  }
  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_worker_day_routing_request", "The work-style request is invalid.");
  }
  const routingMode = typeof body.routingMode === "string" ? body.routingMode.trim() : "";
  if (!ROUTING_MODES.has(routingMode)) return atlasApiError(400, "invalid_worker_day_routing_mode", "That work style is not available.");

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  if (authorized.access.membership.role !== "farm_hand") return atlasApiError(403, "farm_hand_required", "This work-style control is for the active farm hand.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("set_worker_day_routing_mode_v1", { p_routing_mode: routingMode });
  if (error) return rpcFailure(error);
  return privateJson({ ok: true, state: data });
}
