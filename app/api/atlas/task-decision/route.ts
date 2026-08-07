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
const CHOICES = new Set(["marketplace", "detached_garage", "handled_elsewhere"]);

type DecisionBody = {
  taskId?: unknown;
  choice?: unknown;
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

function decisionError(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "task_decision_forbidden", error.message || "This decision is not available to the selected account.");
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "task_decision_not_found", "The decision task was not found.");
  }
  if (error.code === "22023") {
    return atlasApiError(400, "task_decision_rejected", error.message || "That decision could not be saved.");
  }
  return atlasApiError(500, "task_decision_failed", error.message || "Atlas could not save this decision.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "task-decision-v1") {
    return atlasApiError(400, "task_decision_intent_required", "A valid decision intent is required.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: DecisionBody;
  try {
    body = await readAtlasJsonBody(request) as DecisionBody;
  } catch {
    return atlasApiError(400, "invalid_task_decision_request", "The decision request is invalid.");
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const choice = typeof body.choice === "string" ? body.choice.trim() : "";
  if (!UUID_PATTERN.test(taskId) || !CHOICES.has(choice)) {
    return atlasApiError(400, "invalid_task_decision_request", "Task and decision choice are required.");
  }

  const context = await readAtlasOwnerOperatorContext();
  const membershipId = effectiveOperatorMembershipId(context);
  if (!membershipId) {
    return atlasApiError(403, "task_decision_membership_required", "An active farm membership is required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .schema("atlas")
    .rpc("resolve_task_decision_selector_v1", {
      p_task_id: taskId,
      p_choice: choice,
      p_effective_membership_id: membershipId,
    });

  if (error) return decisionError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_task_decision_result", "Atlas returned an invalid decision result.");
  }

  return privateJson({ ok: true, result: data as Record<string, unknown> });
}
