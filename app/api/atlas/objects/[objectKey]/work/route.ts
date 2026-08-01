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
  if (error.code === "42501") return atlasApiError(403, "object_work_forbidden", error.message || "This work action is not available to this account.");
  if (error.code === "P0002") return atlasApiError(404, "object_work_not_found", error.message || "The place or work card was not found.");
  if (error.code === "22023") return atlasApiError(400, "object_work_rejected", error.message || fallback);
  if (error.code === "23505") return atlasApiError(409, "object_work_duplicate", error.message || "Equivalent work is already active.");
  if (error.code === "55000") return atlasApiError(409, "object_work_already_released", error.message || fallback);
  return atlasApiError(500, "object_work_failed", fallback);
}

export async function GET(_request: Request, context: RouteContext) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  const { objectKey } = await context.params;
  const key = objectKey.trim();
  if (!key || key.length > 160) return atlasApiError(400, "invalid_object_key", "A valid object key is required.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("object_work_context_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_object_key: key,
  });
  if (error) return rpcResponse(error as RpcError, "Atlas could not load work for this place.");
  return privateJson({ ok: true, context: data });
}

export async function POST(request: Request, context: RouteContext) {
  if (request.headers.get("x-atlas-intent") !== "object-work-authoring-v1") {
    return atlasApiError(400, "object_work_intent_required", "A valid object-work intent is required.");
  }
  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;
  const { objectKey } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_object_work", "The object-work request is invalid.");
  }

  const title = text(body.title);
  const doneDefinition = text(body.doneDefinition);
  const dueDate = text(body.dueDate);
  const assignedMembershipId = text(body.assignedMembershipId);
  const idempotencyKey = text(body.idempotencyKey);
  if (!title || !doneDefinition || !assignedMembershipId || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !idempotencyKey) {
    return atlasApiError(400, "invalid_object_work", "Title, done definition, assignee, due date, and idempotency key are required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("create_object_work_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_object_key: objectKey.trim(),
    p_action_kind: text(body.actionKind),
    p_title: title,
    p_instructions: text(body.instructions) || null,
    p_done_definition: doneDefinition,
    p_unlock_text: text(body.unlockText) || null,
    p_effort_class: text(body.effortClass),
    p_assigned_membership_id: assignedMembershipId,
    p_due_date: dueDate,
    p_work_window_key: text(body.workWindowKey),
    p_release_mode: text(body.releaseMode),
    p_crop_cycle_ids: stringList(body.cropCycleIds),
    p_steps: stringList(body.steps),
    p_idempotency_key: idempotencyKey,
  });
  if (error) return rpcResponse(error as RpcError, "Atlas could not create this work card.");
  const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  return privateJson({ ok: true, ...result });
}

export async function DELETE(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "cancel-object-work-plan-v1") {
    return atlasApiError(400, "object_work_intent_required", "A valid cancellation intent is required.");
  }
  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_object_work", "The cancellation request is invalid.");
  }
  const workItemId = text(body.workItemId);
  if (!workItemId) return atlasApiError(400, "object_work_required", "Choose planned work to cancel.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("cancel_object_work_plan_v1", {
    p_work_item_id: workItemId,
    p_reason: text(body.reason) || null,
  });
  if (error) return rpcResponse(error as RpcError, "Atlas could not cancel this planned work.");
  return privateJson({ ok: true, workItem: data });
}
