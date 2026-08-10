import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { resolveTaskMove } from "@/lib/atlas/task-move-resolver";

export const dynamic = "force-dynamic";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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
  if (!isUuid(taskId)) {
    return privateJson({ ok: false, error: "A valid task ID is required." }, 400);
  }

  try {
    const assembly = await resolveTaskMove(taskId);
    if (!assembly) return privateJson({ ok: false, error: "Task not found." }, 404);
    return privateJson({ ok: true, assembly });
  } catch (error) {
    console.error("Atlas Task Move resolution failed:", error);
    return privateJson({ ok: false, error: "Atlas could not resolve this task move." }, 500);
  }
}
