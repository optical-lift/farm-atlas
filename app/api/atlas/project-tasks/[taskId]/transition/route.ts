import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

type ProjectTransition = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function isTransition(value: unknown): value is ProjectTransition {
  return value === "done"
    || value === "partial"
    || value === "blocked"
    || value === "not_relevant"
    || value === "changed_plan";
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);
  if (!session.organizationMemberships.length) {
    return privateJson({ ok: false, error: "Feast Guild membership is required." }, 403);
  }

  const { taskId } = await context.params;
  let input: { transition?: unknown; note?: unknown } = {};
  try {
    input = await request.json() as typeof input;
  } catch {
    return privateJson({ ok: false, error: "A task outcome is required." }, 400);
  }

  if (!isTransition(input.transition)) {
    return privateJson({ ok: false, error: "Unsupported project task outcome." }, 400);
  }

  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("transition_project_task_v1", {
    p_task_id: taskId,
    p_transition: input.transition,
    p_note: note,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
    return privateJson({ ok: false, error: error.message || "Project task update failed." }, status);
  }

  return privateJson({ ok: true, taskId: data, transition: input.transition });
}
