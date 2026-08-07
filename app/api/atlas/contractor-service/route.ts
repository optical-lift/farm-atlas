import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type VisitBody = {
  taskId?: unknown;
  serviceDate?: unknown;
};

type RpcError = {
  code?: string;
  message?: string;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function visitError(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "contractor_service_forbidden", error.message || "This service card is not available to the selected account.");
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "contractor_service_not_found", "The contractor service card was not found.");
  }
  if (error.code === "22023") {
    return atlasApiError(400, "contractor_service_rejected", error.message || "That contractor visit could not be saved.");
  }
  return atlasApiError(500, "contractor_service_failed", error.message || "Atlas could not save the contractor visit.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "contractor-service-visit-v1") {
    return atlasApiError(400, "contractor_service_intent_required", "A valid contractor-service intent is required.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: VisitBody;
  try {
    body = await readAtlasJsonBody(request) as VisitBody;
  } catch {
    return atlasApiError(400, "invalid_contractor_service_request", "The contractor-service request is invalid.");
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const serviceDate = typeof body.serviceDate === "string" ? body.serviceDate.trim() : "";
  if (!UUID_PATTERN.test(taskId) || !DATE_PATTERN.test(serviceDate)) {
    return atlasApiError(400, "invalid_contractor_service_request", "Task and service date are required.");
  }

  const context = await readAtlasOwnerOperatorContext();
  const membershipId = effectiveOperatorMembershipId(context);
  if (!membershipId) {
    return atlasApiError(403, "contractor_service_membership_required", "An active farm membership is required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .schema("atlas")
    .rpc("record_contractor_service_visit_v1", {
      p_task_id: taskId,
      p_service_date: serviceDate,
      p_effective_membership_id: membershipId,
    });

  if (error) return visitError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_contractor_service_result", "Atlas returned an invalid contractor-service result.");
  }

  return privateJson({ ok: true, result: data as Record<string, unknown> });
}
