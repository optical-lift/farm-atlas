import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { normalizeWorkerReadiness } from "@/lib/atlas/worker-readiness";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

export async function GET(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = request.nextUrl.searchParams.get("taskId")?.trim() || "";
  if (!UUID_PATTERN.test(taskId)) {
    return privateJson({ ok: false, error: "A valid task ID is required." }, 400);
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_task_execution_readiness_api_v1", {
    p_task_id: taskId,
  });

  if (error) {
    console.error("Task execution readiness failed.", error);
    return privateJson({ ok: false, error: "Task readiness could not be loaded." }, 500);
  }

  const readiness = normalizeWorkerReadiness(data);
  if (!readiness.ok) return privateJson(readiness, 500);
  return privateJson(readiness);
}
