import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);
  if (!session.organizationMemberships.length) {
    return privateJson({ ok: false, error: "Feast Guild membership is required." }, 403);
  }

  const { taskId } = await context.params;
  let note: string | null = null;
  try {
    const input = await request.json() as { note?: unknown };
    note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
  } catch {
    // Completion notes are optional.
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("complete_project_task_v1", {
    p_task_id: taskId,
    p_note: note,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
    return privateJson({ ok: false, error: error.message || "Project task completion failed." }, status);
  }

  return privateJson({ ok: true, taskId: data });
}
