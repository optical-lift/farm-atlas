import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };
type UiAction = "send_now" | "choose_date" | "not_now";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Read-Path": "owner-network-confirmations-v1",
    },
  });
}

function rpcResponse(error: RpcError, fallback: string) {
  if (error.code === "42501") return atlasApiError(403, "network_confirmation_forbidden", error.message || "Networking confirmations are available to farm management.");
  if (error.code === "P0002") return atlasApiError(404, "network_confirmation_not_found", error.message || "That networking confirmation is no longer open.");
  if (error.code === "22023" || error.code === "55000") return atlasApiError(400, "network_confirmation_rejected", error.message || fallback);
  return atlasApiError(500, "network_confirmation_failed", fallback);
}

async function readQueue(farmId: string) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_network_confirmation_queue_v1", {
    p_farm_id: farmId,
  });
  if (error) throw error;
  return data as Record<string, unknown>;
}

export async function GET() {
  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;

  try {
    const queue = await readQueue(authorized.access.membership.farmId);
    return privateJson({ ok: true, queue });
  } catch (error) {
    return rpcResponse(error as RpcError, "Atlas could not load networking confirmations.");
  }
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "owner-network-confirmation-v1") {
    return atlasApiError(400, "network_confirmation_intent_required", "A valid Owner networking-confirmation intent is required.");
  }

  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_network_confirmation", "The networking confirmation request is invalid.");
  }

  const decisionId = text(body.decisionId);
  const action = text(body.action) as UiAction;
  const targetDate = text(body.targetDate);

  if (!validUuid(decisionId) || !new Set<UiAction>(["send_now", "choose_date", "not_now"]).has(action)) {
    return atlasApiError(400, "invalid_network_confirmation", "Choose a valid networking confirmation action.");
  }
  if (action === "choose_date" && (!targetDate || !validDate(targetDate))) {
    return atlasApiError(400, "network_confirmation_date_required", "Choose a valid date for this networking task.");
  }

  const resolverAction = action === "send_now"
    ? "keep_now"
    : action === "choose_date"
      ? "choose_date"
      : "return_to_reservoir";

  try {
    const supabase = await createAtlasServerClient();
    const { data: resolution, error } = await supabase.rpc("resolve_work_reservoir_decision_v1", {
      p_decision_id: decisionId,
      p_action: resolverAction,
      p_target_date: action === "choose_date" ? targetDate : null,
      p_note: action === "not_now" ? "Owner declined this networking step for now." : null,
    });
    if (error) return rpcResponse(error as RpcError, "Atlas could not resolve this networking confirmation.");

    const queue = await readQueue(authorized.access.membership.farmId);
    return privateJson({ ok: true, resolution, queue });
  } catch (error) {
    return rpcResponse(error as RpcError, "Atlas could not refresh networking confirmations.");
  }
}
