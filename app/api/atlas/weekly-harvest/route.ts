import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESULTS = new Set(["harvest_amount", "not_ready", "deadheaded", "crop_exhausted"]);

type RpcError = { code?: string; message?: string };
type Body = {
  taskId?: unknown;
  cropCycleId?: unknown;
  resultKind?: unknown;
  bucketHalves?: unknown;
  idempotencyKey?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integerOrNull(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "weekly-harvest-round-v2",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "Weekly Harvest is outside the active worker context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Weekly Harvest task was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The Harvest result was rejected." }, 400);
  console.error("Weekly Harvest failed.", error);
  return privateJson({ ok: false, error: "Weekly Harvest failed." }, 500);
}

async function requestContext() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return { authorized, operatorContext: null, operatorMembershipId: null };
  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  return { authorized, operatorContext, operatorMembershipId };
}

export async function GET(request: NextRequest) {
  const { authorized, operatorContext, operatorMembershipId } = await requestContext();
  if (!authorized.ok) return authorized.response;
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm Harvest scope." }, 403);
  }

  const taskId = clean(request.nextUrl.searchParams.get("taskId"));
  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid Weekly Harvest task id is required." }, 400);

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_weekly_harvest_task_state_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
      })
    : await supabase.rpc("weekly_harvest_task_state_for_member_v1", {
        p_farm_id: authorized.access.membership.farmId,
        p_task_id: taskId,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid Weekly Harvest state." }, 500);
  }
  return privateJson({ ...(response.data as Record<string, unknown>), ok: true });
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Harvest results require a same-origin Atlas request." }, 403);
  }

  const { authorized, operatorContext, operatorMembershipId } = await requestContext();
  if (!authorized.ok) return authorized.response;
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm Harvest scope." }, 403);
  }

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON Harvest result is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const cropCycleId = clean(body.cropCycleId);
  const resultKind = clean(body.resultKind);
  const bucketHalves = integerOrNull(body.bucketHalves);
  const idempotencyKey = clean(body.idempotencyKey);

  if (!UUID_PATTERN.test(taskId) || !UUID_PATTERN.test(cropCycleId)) {
    return privateJson({ ok: false, error: "A valid Harvest card and crop are required." }, 400);
  }
  if (!RESULTS.has(resultKind)) {
    return privateJson({ ok: false, error: "Record an amount, Not ready, Deadheaded, or Crop exhausted." }, 400);
  }
  if (resultKind === "harvest_amount" && (!bucketHalves || bucketHalves < 1)) {
    return privateJson({ ok: false, error: "Harvest amount must be at least one half bucket." }, 400);
  }
  if (resultKind !== "harvest_amount" && bucketHalves !== null) {
    return privateJson({ ok: false, error: "Not ready, Deadheaded, and Crop exhausted do not take a harvest amount." }, 400);
  }
  if (!idempotencyKey || idempotencyKey.length > 160) {
    return privateJson({ ok: false, error: "A valid idempotency key is required." }, 400);
  }

  const supabase = await createAtlasServerClient();
  const args = {
    p_task_id: taskId,
    p_crop_cycle_id: cropCycleId,
    p_result_kind: resultKind,
    p_bucket_halves: resultKind === "harvest_amount" ? bucketHalves : null,
    p_idempotency_key: idempotencyKey,
  };
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_weekly_harvest_row_v2", {
        p_effective_membership_id: operatorMembershipId,
        ...args,
      })
    : await supabase.rpc("record_weekly_harvest_row_for_member_v2", {
        p_farm_id: authorized.access.membership.farmId,
        ...args,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid Harvest result." }, 500);
  }
  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
  });
}
