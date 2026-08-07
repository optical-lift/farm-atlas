import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "project-pull-return-v1") {
    return atlasApiError(400, "project_pull_intent_required", "A valid Atlas project-pull intent is required.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const body = await readAtlasJsonBody(request);
  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!taskId) {
    return atlasApiError(400, "project_pull_task_required", "A project task is required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("return_project_item_to_pool_v1", {
    p_task_id: taskId,
    p_note: note || "Returned from today without rescheduling.",
  });

  if (error) {
    if (error.code === "42501") return atlasApiError(403, "project_pull_return_forbidden", "This project card cannot be returned by the selected account.");
    if (error.code === "P0002") return atlasApiError(404, "project_pull_task_not_found", "The project task was not found.");
    if (error.code === "22023") return atlasApiError(400, "not_project_pull_task", "This is not a pulled project task.");
    if (error.code === "55000") return atlasApiError(409, "project_pull_return_rejected", error.message || "This project task can no longer return to the pool.");
    return atlasApiError(500, "project_pull_return_failed", "Atlas could not return this card to the project pool.");
  }

  return privateJson({ ok: true, result: data });
}
