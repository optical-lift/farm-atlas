import { NextResponse } from "next/server";

import type { AtlasBell, AtlasBellAction } from "@/lib/atlas/bell-contract";
import { atlasApiError, readAtlasJsonBody } from "@/lib/atlas/api-access";
import { readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Read-Path": "bell-v4",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "bell_forbidden", error.message || "This Bell is not available to the selected account.");
  if (error.code === "22023") return atlasApiError(400, "bell_action_rejected", error.message || "Atlas rejected that Bell action.");
  return atlasApiError(500, "bell_failed", "Atlas could not update the Bell.");
}

async function requestContext() {
  const session = await getAtlasSession();
  if (!session) return null;
  const operatorContext = await readAtlasOwnerOperatorContext();
  const farmId = operatorContext?.isOperating
    ? operatorContext.effective.farmId
    : session.activeFarmId ?? session.memberships[0]?.farmId ?? null;
  const effectiveMembershipId = operatorContext?.isOperating
    ? operatorContext.effective.farmMembershipId
    : null;
  return { farmId, effectiveMembershipId };
}

async function readBell(farmId: string, effectiveMembershipId: string | null, limit: number) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("bell_history_v4", {
    p_farm_id: farmId,
    p_effective_membership_id: effectiveMembershipId,
    p_limit: limit,
    p_before: null,
  });
  if (error) throw error;
  return data as AtlasBell;
}

export async function GET(request: Request) {
  const context = await requestContext();
  if (!context) return privateJson({ ok: false, error: "Sign in required." }, 401);
  if (!context.farmId) return privateJson({ ok: false, error: "The selected account has no active farm membership." }, 403);

  const rawLimit = new URL(request.url).searchParams.get("limit");
  const parsedLimit = rawLimit ? Number(rawLimit) : 40;
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
    return privateJson({ ok: false, error: "limit must be an integer from 1 to 100." }, 400);
  }

  try {
    const bell = await readBell(context.farmId, context.effectiveMembershipId, parsedLimit);
    return privateJson({ ok: true, bell });
  } catch (error) {
    console.error("Atlas Bell read failed:", error);
    return privateJson({ ok: false, error: "The Bell could not be loaded." }, 500);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "bell-state-v1") {
    return atlasApiError(400, "bell_intent_required", "A valid Bell intent is required.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_bell_request", "The Bell request is invalid.");
  }

  const action = typeof body.action === "string" ? body.action.trim() as AtlasBellAction : null;
  if (!action || !["read", "acknowledge", "visit"].includes(action)) {
    return atlasApiError(400, "invalid_bell_action", "Choose read, acknowledge, or visit.");
  }

  const context = await requestContext();
  if (!context) return atlasApiError(401, "sign_in_required", "Sign in required.");
  if (!context.farmId) return atlasApiError(403, "farm_membership_required", "The selected account has no active farm membership.");

  const supabase = await createAtlasServerClient();
  if (action === "visit") {
    const seenThrough = typeof body.seenThrough === "string" && !Number.isNaN(new Date(body.seenThrough).getTime())
      ? body.seenThrough
      : null;
    const { data, error } = await supabase.rpc("record_bell_visit_v1", {
      p_farm_id: context.farmId,
      p_seen_through: seenThrough,
      p_effective_membership_id: context.effectiveMembershipId,
    });
    if (error) return rpcFailure(error);
    return privateJson({ ok: true, result: data });
  }

  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!UUID_PATTERN.test(eventId)) {
    return atlasApiError(400, "invalid_bell_event", "A valid Bell event id is required.");
  }

  const { data, error } = await supabase.rpc("mark_bell_event_v1", {
    p_farm_id: context.farmId,
    p_event_id: eventId,
    p_action: action,
    p_effective_membership_id: context.effectiveMembershipId,
  });
  if (error) return rpcFailure(error);

  return privateJson({ ok: true, result: data });
}
