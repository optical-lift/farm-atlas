import { NextResponse } from "next/server";

import { atlasApiError, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
  if (!taskId) return atlasApiError(400, "task_plant_contents_task_required", "A task is required.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("task_plant_contents_v1", { p_task_id: taskId });
  if (error?.code === "42501") return atlasApiError(403, "task_plant_contents_forbidden", "This task is not available to the signed-in farm member.");
  if (error?.code === "P0002") return atlasApiError(404, "task_plant_contents_not_found", "The task was not found.");
  if (error) return atlasApiError(500, "task_plant_contents_read_failed", "Atlas could not load the plants in this bed.");

  const payload = data as { taskId?: string; contents?: unknown[] } | null;
  return privateJson({
    ok: true,
    taskId: payload?.taskId ?? taskId,
    contents: Array.isArray(payload?.contents) ? payload.contents : [],
  });
}
