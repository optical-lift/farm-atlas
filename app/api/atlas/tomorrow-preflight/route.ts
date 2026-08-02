import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import type {
  AtlasReservoirDecisionAction,
  AtlasTomorrowPreflight,
} from "@/lib/atlas/tomorrow-preflight-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

const DECISION_ACTIONS = new Set<AtlasReservoirDecisionAction>([
  "keep_now",
  "choose_date",
  "return_to_reservoir",
  "archive",
]);

function centralTomorrowIso() {
  const now = new Date();
  const centralToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const tomorrow = new Date(`${centralToday}T12:00:00-05:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

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
      "X-Atlas-Read-Path": "owner-tomorrow-preflight-v1",
    },
  });
}

function rpcResponse(error: RpcError, fallback: string) {
  if (error.code === "42501") return atlasApiError(403, "preflight_forbidden", error.message || "Tomorrow Preflight is available to farm management.");
  if (error.code === "P0002") return atlasApiError(404, "preflight_decision_not_found", error.message || "That decision is no longer open.");
  if (error.code === "22023") return atlasApiError(400, "preflight_decision_rejected", error.message || fallback);
  return atlasApiError(500, "preflight_failed", fallback);
}

async function readPreflight(farmId: string, workDate: string) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_tomorrow_preflight_v1", {
    p_farm_id: farmId,
    p_work_date: workDate,
  });
  if (error) throw error;
  return data as AtlasTomorrowPreflight;
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;

  const requestedDate = new URL(request.url).searchParams.get("date")?.trim() ?? "";
  const workDate = requestedDate || centralTomorrowIso();
  if (!validDate(workDate)) {
    return atlasApiError(400, "invalid_preflight_date", "Choose a valid YYYY-MM-DD farm day.");
  }

  try {
    const preflight = await readPreflight(authorized.access.membership.farmId, workDate);
    return privateJson({ ok: true, preflight });
  } catch (error) {
    return rpcResponse(error as RpcError, "Atlas could not load Tomorrow Preflight.");
  }
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "tomorrow-preflight-decision-v1") {
    return atlasApiError(400, "preflight_intent_required", "A valid Tomorrow Preflight decision intent is required.");
  }

  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_preflight_decision", "The reservoir decision request is invalid.");
  }

  const decisionId = text(body.decisionId);
  const action = text(body.action) as AtlasReservoirDecisionAction;
  const targetDate = text(body.targetDate);
  const workDate = text(body.workDate) || centralTomorrowIso();
  const note = text(body.note);

  if (!validUuid(decisionId) || !DECISION_ACTIONS.has(action)) {
    return atlasApiError(400, "invalid_preflight_decision", "Choose a valid decision and action.");
  }
  if (!validDate(workDate) || (targetDate && !validDate(targetDate))) {
    return atlasApiError(400, "invalid_preflight_date", "Choose a valid YYYY-MM-DD farm day.");
  }
  if (action === "choose_date" && !targetDate) {
    return atlasApiError(400, "preflight_date_required", "Choose the date when this work should return.");
  }

  try {
    const supabase = await createAtlasServerClient();
    const { data: resolution, error } = await supabase.rpc("resolve_work_reservoir_decision_v1", {
      p_decision_id: decisionId,
      p_action: action,
      p_target_date: targetDate || null,
      p_note: note || null,
    });
    if (error) return rpcResponse(error as RpcError, "Atlas could not resolve this reservoir decision.");

    const preflight = await readPreflight(authorized.access.membership.farmId, workDate);
    return privateJson({ ok: true, resolution, preflight });
  } catch (error) {
    return rpcResponse(error as RpcError, "Atlas could not refresh Tomorrow Preflight.");
  }
}
