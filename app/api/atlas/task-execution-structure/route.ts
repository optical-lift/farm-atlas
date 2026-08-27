import { NextResponse } from "next/server";

import { atlasApiError, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function structureError(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "task_execution_structure_forbidden", "This task structure is not available to the selected account.");
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "task_execution_structure_not_found", "The task was not found.");
  }
  return atlasApiError(500, "task_execution_structure_failed", "Atlas could not load the task structure.");
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim() ?? "";
  if (!UUID_PATTERN.test(taskId)) {
    return atlasApiError(400, "task_execution_structure_task_required", "A valid task is required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_task_execution_structure_api_v1", {
    p_task_id: taskId,
  });

  if (error) return structureError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_task_execution_structure", "Atlas returned an invalid task structure.");
  }

  return privateJson({ ok: true, structure: data });
}
