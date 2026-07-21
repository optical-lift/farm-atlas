import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import {
  AtlasTaskTransitionInputError,
  atlasTaskTransitionRpcForRole,
  normalizeAtlasTaskTransitionInput,
} from "@/lib/atlas/task-transition-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = {
  code?: string;
};

type RpcResult = Record<string, unknown>;

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function inputError(error: unknown) {
  if (error instanceof AtlasTaskTransitionInputError) {
    return atlasApiError(error.status, error.code, error.message);
  }
  return atlasApiError(400, "invalid_transition_request", "The task update request is invalid.");
}

function rpcError(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "task_transition_forbidden", "This task cannot be changed by the signed-in user.");
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "task_not_found", "The task was not found.");
  }
  if (error.code === "22023") {
    return atlasApiError(400, "task_transition_rejected", "The task update was rejected.");
  }
  return atlasApiError(500, "task_transition_failed", "Atlas could not update the task.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "task-transition-v1") {
    return atlasApiError(400, "task_transition_intent_required", "A valid Atlas task intent is required.");
  }

  let input;
  try {
    const body = await readAtlasJsonBody(request);
    input = normalizeAtlasTaskTransitionInput(body);
  } catch (error) {
    return inputError(error);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let rpcName;
  try {
    rpcName = atlasTaskTransitionRpcForRole(
      authorized.access.membership.role,
      input.transition,
    );
  } catch (error) {
    return inputError(error);
  }

  const supabase = await createAtlasServerClient();

  let data: unknown;
  let error: RpcError | null;

  if (rpcName === "worker_record_task_transition_v1") {
    const response = await supabase.rpc("worker_record_task_transition_v1", {
      p_task_id: input.taskId,
      p_transition: input.transition,
      p_idempotency_key: input.idempotencyKey,
      p_note: input.note,
      p_reason: input.reason,
      p_payload: input.payload,
    });
    data = response.data;
    error = response.error;
  } else {
    const response = await supabase.rpc("owner_record_task_transition_v1", {
      p_task_id: input.taskId,
      p_transition: input.transition,
      p_idempotency_key: input.idempotencyKey,
      p_target_date: input.targetDate,
      p_note: input.note,
      p_reason: input.reason,
      p_lane_key: input.laneKey,
      p_work_key: input.workKey,
      p_payload: input.payload,
      p_existing_field_log_id: input.existingFieldLogId,
    });
    data = response.data;
    error = response.error;
  }

  if (error) return rpcError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_transition_result", "Atlas returned an invalid task result.");
  }

  const result = data as RpcResult;
  return privateJson({
    ...result,
    ok: true,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  });
}
