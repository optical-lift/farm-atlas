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

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function rpcResponse(error: RpcError, fallback: string) {
  if (error.code === "42501") return atlasApiError(403, "object_work_forbidden", error.message || "This work action is not available to this account.");
  if (error.code === "P0002") return atlasApiError(404, "object_work_not_found", error.message || "The place or work card was not found.");
  if (error.code === "22023") return atlasApiError(400, "object_work_rejected", error.message || fallback);
  if (error.code === "23505") return atlasApiError(409, "object_work_duplicate", error.message || "Equivalent work is already active.");
  if (error.code === "55000") return atlasApiError(409, "object_work_already_released", error.message || fallback);
  return atlasApiError(500, "object_work_failed", fallback);
}

export async function GET(request: Request, context: RouteContext) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  const { objectKey } = await context.params;
  const key = objectKey.trim();
  if (!key || key.length > 160) return atlasApiError(400, "invalid_object_key", "A valid object key is required.");

  const url = new URL(request.url);
  const membershipId = text(url.searchParams.get("membershipId"));
  const dueDate = text(url.searchParams.get("dueDate"));
  if ((membershipId && !validUuid(membershipId)) || (dueDate && !validDate(dueDate))) {
    return atlasApiError(400, "invalid_day_load", "Choose a valid assignee and farm day.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("object_work_context_v2", {
    p_farm_id: authorized.access.membership.farmId,
    p_object_key: key,
    p_membership_id: membershipId || null,
    p_work_date: dueDate || null,
  });
  if (error) return rpcResponse(error as RpcError, "Atlas could not load work for this place.");
  return privateJson({ ok: true, context: data });
}

export async function POST(request: Request, context: RouteContext) {
  if (request.headers.get("x-atlas-intent") !== "object-work-state-change-v1") {
    return atlasApiError(400, "object_work_intent_required", "A valid object-work state-change intent is required.");
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
  const currentTruth = text(body.currentTruth);
  const afterTruth = text(body.afterTruth);
  const dueDate = text(body.dueDate);
  const assignedMembershipId = text(body.assignedMembershipId);
  const dateCommitment = text(body.dateCommitment);
  const idempotencyKey = text(body.idempotencyKey);

  if (!title || !currentTruth || !afterTruth || !validUuid(assignedMembershipId) || !validDate(dueDate) || !idempotencyKey) {
    return atlasApiError(400, "invalid_object_work", "Title, current truth, truth after completion, assignee, due date, and idempotency key are required.");
  }
  if (currentTruth === afterTruth) {
    return atlasApiError(400, "unchanged_object_truth", "The current truth and truth after completion must describe a real change.");
  }
  if (dateCommitment !== "hard_date" && dateCommitment !== "floating") {
    return atlasApiError(400, "invalid_date_commitment", "Choose whether this must happen that day or may float around that day.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("create_object_work_v3", {
    p_farm_id: authorized.access.membership.farmId,
    p_object_key: objectKey.trim(),
    p_action_kind: text(body.actionKind),
    p_title: title,
    p_current_truth: currentTruth,
    p_after_truth: afterTruth,
    p_unlock_text: text(body.unlockText) || null,
    p_effort_class: text(body.effortClass),
    p_assigned_membership_id: assignedMembershipId,
    p_due_date: dueDate,
    p_work_window_key: text(body.workWindowKey),
    p_date_commitment: dateCommitment,
    p_bring_into_work_now: body.bringIntoWorkNow === true,
    p_crop_cycle_ids: stringList(body.cropCycleIds),
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
