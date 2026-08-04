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

type RpcError = { code?: string; message?: string };

type ChecklistPostBody = {
  taskId?: unknown;
  itemKey?: unknown;
  checked?: unknown;
  idempotencyKey?: unknown;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function checklistError(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "execution_checklist_forbidden", "This checklist is not available to the selected account.");
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "execution_checklist_not_found", "The checklist or checklist item was not found.");
  }
  if (error.code === "22023") {
    return atlasApiError(400, "execution_checklist_rejected", error.message || "The checklist update was rejected.");
  }
  return atlasApiError(500, "execution_checklist_failed", "Atlas could not load or update the checklist.");
}

async function operatorMembershipId() {
  const context = await readAtlasOwnerOperatorContext();
  return effectiveOperatorMembershipId(context);
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim() ?? "";
  if (!UUID_PATTERN.test(taskId)) {
    return atlasApiError(400, "execution_checklist_task_required", "A valid task is required.");
  }

  const supabase = await createAtlasServerClient();
  const effectiveMembershipId = await operatorMembershipId();
  const { data, error } = await supabase.rpc("task_execution_checklist_v1", {
    p_task_id: taskId,
    p_effective_membership_id: effectiveMembershipId,
  });

  if (error) return checklistError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_execution_checklist", "Atlas returned an invalid checklist.");
  }

  return privateJson({ ok: true, checklist: data });
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "task-execution-checklist-v1") {
    return atlasApiError(400, "execution_checklist_intent_required", "A valid checklist intent is required.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: ChecklistPostBody;
  try {
    body = await readAtlasJsonBody(request) as ChecklistPostBody;
  } catch {
    return atlasApiError(400, "invalid_execution_checklist_request", "The checklist request is invalid.");
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const itemKey = typeof body.itemKey === "string" ? body.itemKey.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!UUID_PATTERN.test(taskId) || !itemKey || typeof body.checked !== "boolean" || !idempotencyKey) {
    return atlasApiError(400, "invalid_execution_checklist_request", "Task, checklist item, state, and idempotency key are required.");
  }

  const supabase = await createAtlasServerClient();
  const effectiveMembershipId = await operatorMembershipId();
  const { data, error } = await supabase.rpc("record_task_execution_check_v1", {
    p_task_id: taskId,
    p_item_key: itemKey,
    p_checked: body.checked,
    p_idempotency_key: idempotencyKey,
    p_effective_membership_id: effectiveMembershipId,
  });

  if (error) return checklistError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_execution_checklist", "Atlas returned an invalid checklist.");
  }

  return privateJson({ ok: true, checklist: data });
}
