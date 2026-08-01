import { NextResponse } from "next/server";

import { atlasApiError, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
  if (!taskId) return atlasApiError(400, "maintenance_task_required", "A task is required.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("maintenance_directives_for_task_v1", { p_task_id: taskId });
  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") return atlasApiError(403, "maintenance_directive_forbidden", rpcError.message || "This task is not visible.");
    return atlasApiError(500, "maintenance_directive_read_failed", "Atlas could not load the attached maintenance instruction.");
  }

  return NextResponse.json(
    { ok: true, directives: Array.isArray(data) ? data : [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
