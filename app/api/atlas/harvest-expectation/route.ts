import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONFIDENCE = new Set(["possible", "likely", "confident"]);

type RpcError = { code?: string; message?: string };
type Body = {
  farmId?: unknown;
  cropCycleId?: unknown;
  expectedDate?: unknown;
  estimatedQuantity?: unknown;
  unit?: unknown;
  confidence?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "crop-harvest-expectation-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "Expected harvest is outside the active farm context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "The crop cycle was not found." }, 404);
  if (error.code === "23505") return privateJson({ ok: false, error: error.message || "This expected harvest was already recorded differently." }, 409);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The expected harvest was rejected." }, 400);
  console.error("Expected harvest write failed.", error);
  return privateJson({ ok: false, error: "Expected harvest could not be saved." }, 500);
}

async function requestContext() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return { authorized, operatorContext: null, operatorMembershipId: null };
  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  return { authorized, operatorContext, operatorMembershipId };
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Expected harvest requires a same-origin Atlas request." }, 403);
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
    return privateJson({ ok: false, error: "A JSON expected harvest is required." }, 400);
  }

  const farmId = clean(body.farmId);
  const cropCycleId = clean(body.cropCycleId);
  const expectedDate = clean(body.expectedDate);
  const unit = clean(body.unit);
  const confidence = clean(body.confidence).toLowerCase() || "likely";
  const note = clean(body.note);
  const idempotencyKey = clean(body.idempotencyKey);
  const hasQuantityInput = !(body.estimatedQuantity === null || body.estimatedQuantity === undefined || body.estimatedQuantity === "");
  const estimatedQuantity = positiveNumberOrNull(body.estimatedQuantity);

  if (!UUID_PATTERN.test(farmId) || !UUID_PATTERN.test(cropCycleId)) {
    return privateJson({ ok: false, error: "Choose a valid farm crop for the expected harvest." }, 400);
  }
  if (!DATE_PATTERN.test(expectedDate)) {
    return privateJson({ ok: false, error: "Choose a valid expected harvest date." }, 400);
  }
  if (hasQuantityInput && estimatedQuantity === null) {
    return privateJson({ ok: false, error: "Expected quantity must be greater than zero." }, 400);
  }
  if ((estimatedQuantity !== null && !unit) || (estimatedQuantity === null && Boolean(unit))) {
    return privateJson({ ok: false, error: "Expected quantity and unit must be recorded together." }, 400);
  }
  if (unit.length > 40) {
    return privateJson({ ok: false, error: "Expected quantity unit must be 40 characters or fewer." }, 400);
  }
  if (!CONFIDENCE.has(confidence)) {
    return privateJson({ ok: false, error: "Choose Possible, Likely, or Confident." }, 400);
  }
  if (note.length > 1000) {
    return privateJson({ ok: false, error: "Expected harvest note must be 1000 characters or fewer." }, 400);
  }
  if (!idempotencyKey || idempotencyKey.length > 160) {
    return privateJson({ ok: false, error: "A valid expected harvest idempotency key is required." }, 400);
  }

  const authorizedFarmId = authorized.access.membership.farmId;
  if (!operatorMembershipId && farmId !== authorizedFarmId) {
    return privateJson({ ok: false, error: "This farm is outside the signed-in account." }, 403);
  }

  const supabase = await createAtlasServerClient();
  const args = {
    p_crop_cycle_id: cropCycleId,
    p_expected_date: expectedDate,
    p_estimated_quantity: estimatedQuantity,
    p_unit: unit || null,
    p_confidence: confidence,
    p_note: note || null,
    p_idempotency_key: idempotencyKey,
  };

  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_crop_harvest_expectation_v1", {
        p_effective_membership_id: operatorMembershipId,
        ...args,
      })
    : await supabase.rpc("record_crop_harvest_expectation_for_member_v1", {
        p_farm_id: farmId,
        ...args,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid expected harvest result." }, 500);
  }

  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
  });
}
