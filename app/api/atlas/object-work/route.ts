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

function rpcResponse(error: RpcError, fallback: string) {
  if (error.code === "42501") return atlasApiError(403, "object_work_forbidden", error.message || "This object work is not visible to this account.");
  if (error.code === "P0002") return atlasApiError(404, "object_work_not_found", error.message || "The work item was not found.");
  return atlasApiError(500, "object_work_failed", fallback);
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  const taskId = new URL(request.url).searchParams.get("taskId")?.trim() ?? "";
  if (!taskId) return atlasApiError(400, "task_id_required", "A task ID is required.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("object_work_for_task_v1", { p_task_id: taskId });
  if (error) return rpcResponse(error as RpcError, "Atlas could not load the object-work context.");
  return privateJson({ ok: true, workItem: data });
}

export async function PATCH(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "object-work-step-v1") {
    return atlasApiError(400, "object_work_intent_required", "A valid checklist intent is required.");
  }
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_object_work_step", "The checklist request is invalid.");
  }
  const stepId = text(body.stepId);
  if (!stepId || typeof body.complete !== "boolean") {
    return atlasApiError(400, "invalid_object_work_step", "A checklist step and completion state are required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("set_object_work_step_v1", {
    p_step_id: stepId,
    p_complete: body.complete,
  });
  if (error) return rpcResponse(error as RpcError, "Atlas could not update this checklist step.");
  return privateJson({ ok: true, workItem: data });
}
