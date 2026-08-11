import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
  if (error.code === "42501") return atlasApiError(403, "manual_task_forbidden", error.message || "This task action is not available to this account.");
  if (error.code === "P0002") return atlasApiError(404, "manual_task_not_found", error.message || "The farm place was not found.");
  if (error.code === "22023") return atlasApiError(400, "manual_task_rejected", error.message || fallback);
  if (error.code === "23505") return atlasApiError(409, "manual_task_duplicate", error.message || "Equivalent work is already active.");
  return atlasApiError(500, "manual_task_failed", fallback);
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const url = new URL(request.url);
  const objectKey = text(url.searchParams.get("objectKey"));
  const membershipId = text(url.searchParams.get("membershipId"));
  const dueDate = text(url.searchParams.get("dueDate"));

  if (!objectKey || objectKey.length > 160) return atlasApiError(400, "invalid_object_key", "A valid farm place is required.");
  if ((membershipId && !validUuid(membershipId)) || (dueDate && !validDate(dueDate))) {
    return atlasApiError(400, "invalid_day_load", "Choose a valid assignee and farm day.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("manual_task_context_v1", {
    p_object_key: objectKey,
    p_assigned_membership_id: membershipId || null,
    p_due_date: dueDate || null,
  });
  if (error) return rpcResponse(error as RpcError, "Atlas could not load this farm place.");
  return privateJson({ ok: true, context: data });
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "manual-task-authoring-v1") {
    return atlasApiError(400, "manual_task_intent_required", "A valid manual-task authoring intent is required.");
  }
  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_manual_task", "The task request is invalid.");
  }

  const objectKey = text(body.objectKey);
  const title = text(body.title);
  const currentTruth = text(body.currentTruth);
  const afterTruth = text(body.afterTruth);
  const dueDate = text(body.dueDate);
  const assignedMembershipId = text(body.assignedMembershipId);
  const dateCommitment = text(body.dateCommitment);
  const idempotencyKey = text(body.idempotencyKey);

  if (!objectKey || objectKey.length > 160 || !title || !currentTruth || !afterTruth || !validUuid(assignedMembershipId) || !validDate(dueDate) || !idempotencyKey) {
    return atlasApiError(400, "invalid_manual_task", "Place, title, current truth, truth after completion, assignee, due date, and idempotency key are required.");
  }
  if (currentTruth === afterTruth) {
    return atlasApiError(400, "unchanged_task_truth", "Current truth and truth after completion must describe a real change.");
  }
  if (dateCommitment !== "hard_date" && dateCommitment !== "floating") {
    return atlasApiError(400, "invalid_date_commitment", "Choose whether this must happen that day or may float around that day.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("create_manual_task_v1", {
    p_object_key: objectKey,
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
  if (error) return rpcResponse(error as RpcError, "Atlas could not create this task.");
  const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  return privateJson({ ok: true, ...result });
}
