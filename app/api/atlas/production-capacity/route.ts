import { NextRequest, NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { loadOwnerProductionCapacity } from "@/lib/atlas-data/production-capacity";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const confidences = new Set(["measured", "confirmed", "estimated"]);

type RpcError = { code?: string; message?: string };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mutationError(error: RpcError) {
  const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 500;
  return atlasApiError(status, "production_capacity_failed", error.message || "Production capacity update failed.");
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return Boolean(
    origin &&
      origin === request.nextUrl.origin &&
      request.headers.get("x-atlas-intent") === "production-capacity-v1",
  );
}

export async function GET() {
  try {
    const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner"] });
    if (!authorized.ok) return authorized.response;

    const supabase = await createAtlasServerClient();
    const snapshot = await loadOwnerProductionCapacity(
      supabase,
      authorized.access.membership.farmId,
    );

    return NextResponse.json(
      { ok: true, snapshot },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Atlas-Read-Path": "owner-production-capacity-v1",
        },
      },
    );
  } catch (error) {
    return atlasApiError(
      500,
      "production_capacity_read_failed",
      error instanceof Error ? error.message : "Production capacity failed.",
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!sameOrigin(request)) {
      return atlasApiError(
        403,
        "same_origin_required",
        "Production capacity changes require a same-origin Atlas request.",
      );
    }

    const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner"] });
    if (!authorized.ok) return authorized.response;

    const body = await readAtlasJsonBody(request);
    const action = text(body.action);
    const farmId = authorized.access.membership.farmId;
    const supabase = await createAtlasServerClient();

    let rpcName: string;
    let rpcArgs: Record<string, unknown>;

    if (action === "answer_question") {
      const questionId = text(body.questionId);
      const answerValue = numeric(body.answerValue);
      const confidence = text(body.confidence) || "measured";
      if (!uuidPattern.test(questionId) || answerValue === null || !confidences.has(confidence)) {
        return atlasApiError(400, "invalid_capacity_answer", "Enter a valid capacity answer.");
      }
      rpcName = "owner_answer_capacity_question_v1";
      rpcArgs = {
        p_farm_id: farmId,
        p_question_id: questionId,
        p_answer_value: answerValue,
        p_answer_text: text(body.answerText) || null,
        p_confidence: confidence,
      };
    } else if (action === "assign_bed") {
      const productionLotId = text(body.productionLotId);
      const objectId = text(body.objectId);
      const quantityAssigned = numeric(body.quantityAssigned);
      if (
        !uuidPattern.test(productionLotId) ||
        !uuidPattern.test(objectId) ||
        quantityAssigned === null ||
        quantityAssigned <= 0
      ) {
        return atlasApiError(400, "invalid_bed_assignment", "Choose a bed and enter usable bed-feet.");
      }
      rpcName = "owner_assign_production_bed_v1";
      rpcArgs = {
        p_farm_id: farmId,
        p_production_lot_id: productionLotId,
        p_object_id: objectId,
        p_quantity_assigned: quantityAssigned,
      };
    } else if (action === "release_bed") {
      const assignmentId = text(body.assignmentId);
      if (!uuidPattern.test(assignmentId)) {
        return atlasApiError(400, "invalid_bed_assignment", "The bed assignment was invalid.");
      }
      rpcName = "owner_release_production_bed_v1";
      rpcArgs = { p_farm_id: farmId, p_assignment_id: assignmentId };
    } else if (action === "recalculate") {
      rpcName = "owner_recalculate_production_capacity_v1";
      rpcArgs = { p_farm_id: farmId };
    } else {
      return atlasApiError(400, "unsupported_capacity_action", "Unsupported production capacity action.");
    }

    const { data, error } = await supabase.rpc(rpcName, rpcArgs);
    if (error) return mutationError(error as RpcError);

    return NextResponse.json(
      { ok: true, snapshot: data },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Atlas-Write-Path": "owner-production-capacity-v1",
        },
      },
    );
  } catch (error) {
    return atlasApiError(
      500,
      "production_capacity_write_failed",
      error instanceof Error ? error.message : "Production capacity update failed.",
    );
  }
}
