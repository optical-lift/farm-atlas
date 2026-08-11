import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import {
  effectiveOperatorAccountId,
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasProjectTaskFocus } from "@/lib/atlas/portfolio";
import { getAtlasSession } from "@/lib/atlas/session";
import {
  AtlasTaskTransitionInputError,
  atlasTaskTransitionRpcForRole,
  normalizeAtlasTaskTransitionInput,
} from "@/lib/atlas/task-transition-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };
type RpcResult = Record<string, unknown>;
type ProjectTransition = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

const PROJECT_TRANSITIONS = new Set<ProjectTransition>([
  "done",
  "partial",
  "blocked",
  "not_relevant",
  "changed_plan",
]);

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function inputError(error: unknown) {
  if (error instanceof AtlasTaskTransitionInputError) return atlasApiError(error.status, error.code, error.message);
  return atlasApiError(400, "invalid_transition_request", "The task update request is invalid.");
}

function rpcError(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "task_transition_forbidden", "This task cannot be changed by the selected account.");
  if (error.code === "P0002") return atlasApiError(404, "task_not_found", "The task was not found.");
  if (error.code === "P0003") return atlasApiError(409, "owner_correction_required", error.message || "This completion has linked farm evidence and needs review before it can be corrected.");
  if (error.code === "22023") return atlasApiError(400, "task_transition_rejected", "The task update was rejected.");
  return atlasApiError(500, "task_transition_failed", "Atlas could not update the task.");
}

function projectStatus(transition: ProjectTransition) {
  if (transition === "done") return "done";
  if (transition === "blocked") return "blocked";
  if (transition === "not_relevant" || transition === "changed_plan") return "skipped";
  return "open";
}

async function projectTaskTransition(input: ReturnType<typeof normalizeAtlasTaskTransitionInput>) {
  const session = await getAtlasSession();
  if (!session?.organizationMemberships.length) return null;

  let focus;
  try {
    focus = await readAtlasProjectTaskFocus(input.taskId);
  } catch {
    // A farm task may not participate in the organization portfolio. In that case
    // continue through the normal farm transition path below.
    return null;
  }
  if (!focus) return null;

  if (!focus.permissions.canComplete) {
    return atlasApiError(403, "project_task_transition_forbidden", "This project task cannot be changed by the selected account.");
  }
  if (!PROJECT_TRANSITIONS.has(input.transition as ProjectTransition)) {
    return atlasApiError(400, "project_task_transition_unsupported", "That outcome is not supported for project work.");
  }

  const transition = input.transition as ProjectTransition;
  const operatorContext = await readAtlasOwnerOperatorContext();
  const effectiveAccountId = effectiveOperatorAccountId(operatorContext);
  const supabase = await createAtlasServerClient();
  const { data, error } = effectiveAccountId
    ? await supabase.rpc("owner_operator_transition_project_task_v1", {
        p_effective_account_id: effectiveAccountId,
        p_task_id: input.taskId,
        p_transition: transition,
        p_note: input.note,
      })
    : await supabase.rpc("transition_project_task_v1", {
        p_task_id: input.taskId,
        p_transition: transition,
        p_note: input.note,
      });

  if (error) return rpcError(error as RpcError);

  return privateJson({
    ok: true,
    transitionId: `project:${input.taskId}:${input.idempotencyKey}`,
    taskId: typeof data === "string" ? data : input.taskId,
    status: projectStatus(transition),
    fieldLogId: null,
    taskOutcomeEventId: null,
    childTaskIds: [],
    childrenClosed: 0,
    nextTaskId: null,
    deduplicated: false,
    warnings: [],
    projectTransition: true,
    operatorMode: Boolean(effectiveAccountId),
    effectiveAccountId,
  });
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "task-transition-v1") {
    return atlasApiError(400, "task_transition_intent_required", "A valid Atlas task intent is required.");
  }

  let input;
  try {
    input = normalizeAtlasTaskTransitionInput(await readAtlasJsonBody(request));
  } catch (error) {
    return inputError(error);
  }

  const projectResponse = await projectTaskTransition(input);
  if (projectResponse) return projectResponse;

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  const operating = Boolean(operatorContext?.isOperating);
  if (operating && !operatorMembershipId) {
    return atlasApiError(403, "farm_scope_required", "The selected account has no farm task scope.");
  }

  let rpcName;
  try {
    rpcName = atlasTaskTransitionRpcForRole(operating ? "owner" : authorized.access.membership.role, input.transition);
  } catch (error) {
    return inputError(error);
  }

  const supabase = await createAtlasServerClient();
  let data: unknown;
  let error: RpcError | null;

  if (operating && operatorMembershipId) {
    if (input.transition === "reopened") {
      const response = await supabase.rpc("owner_operator_reopen_task_completion_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: input.taskId,
        p_idempotency_key: input.idempotencyKey,
        p_payload: input.payload,
      });
      data = response.data;
      error = response.error;
    } else {
      const response = await supabase.rpc("owner_operator_record_task_transition_v1", {
        p_effective_membership_id: operatorMembershipId,
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
  } else if (rpcName === "worker_reopen_task_completion_v1") {
    const response = await supabase.rpc("worker_reopen_task_completion_v1", {
      p_task_id: input.taskId,
      p_idempotency_key: input.idempotencyKey,
      p_payload: input.payload,
    });
    data = response.data;
    error = response.error;
  } else if (rpcName === "owner_reopen_task_completion_v1") {
    const response = await supabase.rpc("owner_reopen_task_completion_v1", {
      p_task_id: input.taskId,
      p_idempotency_key: input.idempotencyKey,
      p_payload: input.payload,
    });
    data = response.data;
    error = response.error;
  } else if (rpcName === "worker_record_task_transition_v1") {
    const response = await supabase.rpc("worker_record_task_transition_v1", {
      p_task_id: input.taskId,
      p_transition: input.transition,
      p_idempotency_key: input.idempotencyKey,
      p_note: input.note,
      p_reason: input.reason,
      p_payload: input.payload,
      p_target_date: input.targetDate,
      p_lane_key: input.laneKey,
      p_work_key: input.workKey,
      p_existing_field_log_id: input.existingFieldLogId,
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
  let dependencyStatus: unknown = null;
  if (input.transition === "done" || input.transition === "checklist_done") {
    const dependencyResponse = await supabase.rpc("task_dependency_status_v1", {
      p_task_id: input.taskId,
    });
    if (!dependencyResponse.error && dependencyResponse.data && typeof dependencyResponse.data === "object") {
      dependencyStatus = dependencyResponse.data;
    }
  }

  let recoveryStatus: unknown = null;
  if (!operating && authorized.access.membership.role === "farm_hand" && input.transition === "done") {
    const recoveryResponse = await supabase.rpc("consume_worker_recovery_move_v1", {
      p_task_id: input.taskId,
    });
    if (!recoveryResponse.error && recoveryResponse.data && typeof recoveryResponse.data === "object") {
      recoveryStatus = recoveryResponse.data;
    }
  }

  return privateJson({
    ...result,
    ok: true,
    operatorMode: operating,
    effectiveMembershipId: operatorMembershipId,
    dependencyStatus,
    recoveryStatus,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  });
}
