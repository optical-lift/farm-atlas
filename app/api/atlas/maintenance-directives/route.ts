import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function directiveError(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "maintenance_directive_forbidden", error.message || "This maintenance instruction belongs to another player.");
  if (error.code === "P0002") return atlasApiError(404, "maintenance_directive_not_found", error.message || "The maintenance instruction was not found.");
  if (error.code === "22023") return atlasApiError(400, "maintenance_directive_rejected", error.message || "The maintenance instruction cannot be changed.");
  return atlasApiError(500, "maintenance_directive_failed", "Atlas could not update the maintenance instruction.");
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
  if (!taskId) return atlasApiError(400, "maintenance_task_required", "A task is required.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("maintenance_directives_for_task_v1", { p_task_id: taskId });
  if (error) return directiveError(error as RpcError);

  return NextResponse.json(
    { ok: true, directives: Array.isArray(data) ? data : [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "maintenance-directive-step-v1") {
    return atlasApiError(400, "maintenance_directive_intent_required", "A valid checklist intent is required.");
  }
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_maintenance_step", "The checklist request is invalid.");
  }

  const stepId = text(body.stepId);
  if (!stepId || typeof body.completed !== "boolean") {
    return atlasApiError(400, "invalid_maintenance_step", "Choose a checklist step and its new state.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("set_maintenance_directive_step_v1", {
    p_step_id: stepId,
    p_completed: body.completed,
  });
  if (error) return directiveError(error as RpcError);

  return NextResponse.json(
    { ok: true, directive: data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
