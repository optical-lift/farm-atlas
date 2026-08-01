import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ objectKey: string }> };
type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function rpcResponse(error: RpcError, fallback: string) {
  if (error.code === "42501") return atlasApiError(403, "maintenance_directive_forbidden", error.message || "This maintenance action is not available to this account.");
  if (error.code === "P0002") return atlasApiError(404, "maintenance_directive_not_found", error.message || "The maintenance card was not found.");
  if (error.code === "22023") return atlasApiError(400, "maintenance_directive_rejected", error.message || fallback);
  if (error.code === "55000") return atlasApiError(409, "maintenance_card_not_released", error.message || fallback);
  return atlasApiError(500, "maintenance_directive_failed", fallback);
}

export async function GET(_request: Request, context: RouteContext) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  const { objectKey } = await context.params;
  const key = objectKey.trim();
  if (!key || key.length > 160) return atlasApiError(400, "invalid_object_key", "A valid object key is required.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("maintenance_directive_context_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_object_key: key,
  });
  if (error) return rpcResponse(error as RpcError, "Atlas could not load maintenance work for this place.");
  return privateJson({ ok: true, context: data });
}

export async function POST(request: Request, context: RouteContext) {
  if (request.headers.get("x-atlas-intent") !== "object-maintenance-directive-v1") {
    return atlasApiError(400, "maintenance_directive_intent_required", "A valid maintenance-work intent is required.");
  }
  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;
  const { objectKey } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_maintenance_directive", "The maintenance-work request is invalid.");
  }

  const title = text(body.title);
  const dueDate = text(body.dueDate);
  const assignedMembershipId = text(body.assignedMembershipId);
  const idempotencyKey = text(body.idempotencyKey);
  if (!title || !assignedMembershipId || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !idempotencyKey) {
    return atlasApiError(400, "invalid_maintenance_directive", "Title, assignee, due date, and idempotency key are required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("create_object_maintenance_directive_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_object_key: objectKey.trim(),
    p_maintenance_kind: text(body.maintenanceKind),
    p_directive_kind: text(body.directiveKind),
    p_title: title,
    p_instructions: text(body.instructions) || null,
    p_assigned_membership_id: assignedMembershipId,
    p_due_date: dueDate,
    p_work_window_key: text(body.workWindowKey),
    p_effect_policy: text(body.effectPolicy),
    p_target_condition: text(body.targetCondition) || null,
    p_crop_cycle_ids: stringList(body.cropCycleIds),
    p_steps: stringList(body.steps),
    p_idempotency_key: idempotencyKey,
  });
  if (error) return rpcResponse(error as RpcError, "Atlas could not attach this work to the maintenance card.");
  const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  return privateJson({ ok: true, ...result });
}

export async function DELETE(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "cancel-maintenance-directive-v1") {
    return atlasApiError(400, "maintenance_directive_intent_required", "A valid cancellation intent is required.");
  }
  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_maintenance_directive", "The cancellation request is invalid.");
  }
  const directiveId = text(body.directiveId);
  if (!directiveId) return atlasApiError(400, "maintenance_directive_required", "Choose a maintenance instruction to cancel.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("cancel_maintenance_directive_v1", {
    p_directive_id: directiveId,
    p_reason: text(body.reason) || null,
  });
  if (error) return rpcResponse(error as RpcError, "Atlas could not cancel this maintenance instruction.");
  return privateJson({ ok: true, directive: data });
}
