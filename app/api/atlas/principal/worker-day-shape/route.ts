import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody } from "@/lib/atlas/api-access";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

function nonBlank(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uuid(value: unknown) {
  const text = nonBlank(value);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function localTime(value: unknown) {
  const text = nonBlank(value);
  if (!text || !/^\d{2}:\d{2}$/.test(text)) return null;
  const [hour, minute] = text.split(":").map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return text;
}

function timeMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function isoDate(value: unknown) {
  const text = nonBlank(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function weekdays(value: unknown) {
  if (!Array.isArray(value)) return null;
  const normalized = [...new Set(value.map(Number).filter((day) => Number.isInteger(day)))].sort((a, b) => a - b);
  if (!normalized.length || normalized.some((day) => day < 0 || day > 6) || normalized.length !== value.length) return null;
  return normalized;
}

async function requirePrincipalOwner() {
  const session = await getAtlasSession();
  if (!session) {
    return { ok: false as const, response: atlasApiError(401, "sign_in_required", "Sign in required.") };
  }
  if (!session.organizationMemberships.some((membership) => membership.role === "owner")) {
    return {
      ok: false as const,
      response: atlasApiError(403, "principal_owner_required", "Principal owner access is required."),
    };
  }
  return { ok: true as const };
}

export async function POST(request: Request) {
  const authorized = await requirePrincipalOwner();
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch (error) {
    return atlasApiError(400, "invalid_request", error instanceof Error ? error.message : "Invalid request.");
  }

  const farmId = uuid(body.farmId);
  const membershipId = uuid(body.membershipId);
  const selectedWeekdays = weekdays(body.weekdays);
  const localStart = localTime(body.localStart);
  const localEnd = localTime(body.localEnd);
  const effectiveFrom = isoDate(body.effectiveFrom);
  const reason = nonBlank(body.reason);

  if (!farmId || !membershipId) {
    return atlasApiError(400, "invalid_worker_day_shape_target", "A valid farm and Farm Hand are required.");
  }
  if (!selectedWeekdays) {
    return atlasApiError(400, "invalid_worker_day_shape_weekdays", "Choose one or more unique weekdays.");
  }
  if (!localStart || !localEnd || timeMinutes(localStart) >= timeMinutes(localEnd)) {
    return atlasApiError(400, "invalid_worker_day_shape_window", "Choose a valid local start and end time.");
  }
  if (!effectiveFrom) {
    return atlasApiError(400, "invalid_worker_day_shape_effective_date", "Choose the date this Farm Hand Day Shape becomes effective.");
  }
  if (!reason) {
    return atlasApiError(400, "worker_day_shape_reason_required", "State why this Day Shape is the correct capacity truth.");
  }

  try {
    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("owner_set_worker_day_shape_api_v1", {
      p_farm_id: farmId,
      p_membership_id: membershipId,
      p_weekdays: selectedWeekdays,
      p_local_start: localStart,
      p_local_end: localEnd,
      p_effective_from: effectiveFrom,
      p_reason: reason,
    });
    if (error) throw error;

    return NextResponse.json(
      { ok: true, result: data },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Atlas-Write-Path": "principal-worker-day-shape-v1",
        },
      },
    );
  } catch (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return atlasApiError(403, "farm_owner_required", "Farm Owner access to this Farm Hand is required.");
    }
    if (rpcError.code === "22023" || error instanceof Error) {
      return atlasApiError(400, "worker_day_shape_rejected", error instanceof Error ? error.message : rpcError.message ?? "Worker Day Shape was rejected.");
    }
    console.error("Atlas worker Day Shape authoring failed:", error);
    return atlasApiError(500, "worker_day_shape_failed", "Atlas could not save this Farm Hand Day Shape.");
  }
}
