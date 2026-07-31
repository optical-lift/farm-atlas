import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type Body = {
  taskId?: unknown;
  marketableQuantity?: unknown;
  secondsQuantity?: unknown;
  discardedQuantity?: unknown;
  unit?: unknown;
  moreAvailable?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nonnegativeNumber(value: unknown, fallback: number | null = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) return null;
  return Math.round(number * 100) / 100;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "crop-harvest-cut-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: "This harvest is outside the active worker context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Harvest task was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The harvest count was rejected." }, 400);
  console.error("Crop harvest count failed.", error);
  return privateJson({ ok: false, error: "Crop harvest count failed." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Harvest counts require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON harvest count is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const marketable = nonnegativeNumber(body.marketableQuantity);
  const seconds = nonnegativeNumber(body.secondsQuantity, 0);
  const discarded = nonnegativeNumber(body.discardedQuantity, 0);
  const unit = clean(body.unit);
  const moreAvailable = typeof body.moreAvailable === "boolean" ? body.moreAvailable : null;
  const note = clean(body.note) || null;
  const idempotencyKey = clean(body.idempotencyKey);

  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid task id is required." }, 400);
  if (marketable === null || seconds === null || discarded === null) return privateJson({ ok: false, error: "Harvest quantities must be zero or greater." }, 400);
  if (!unit) return privateJson({ ok: false, error: "Choose the harvest unit." }, 400);
  if (moreAvailable === null) return privateJson({ ok: false, error: "Record whether more remains to harvest." }, 400);
  if (!idempotencyKey) return privateJson({ ok: false, error: "An idempotency key is required." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm harvest scope." }, 403);
  }

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_crop_harvest_cut_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
        p_marketable: marketable,
        p_seconds: seconds,
        p_discarded: discarded,
        p_unit: unit,
        p_more_available: moreAvailable,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      })
    : await supabase.rpc("record_crop_harvest_cut_for_member_v1", {
        p_farm_id: authorized.access.membership.farmId,
        p_task_id: taskId,
        p_marketable: marketable,
        p_seconds: seconds,
        p_discarded: discarded,
        p_unit: unit,
        p_more_available: moreAvailable,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid harvest count." }, 500);
  }

  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
    effectiveMembershipId: operatorMembershipId,
  });
}
