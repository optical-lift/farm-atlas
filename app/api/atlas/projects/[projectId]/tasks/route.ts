import { NextResponse } from "next/server";

import {
  effectiveOperatorAccountId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };
type ProjectTaskInput = { title?: unknown; dueDate?: unknown; note?: unknown };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);
  if (!session.organizationMemberships.length) {
    return privateJson({ ok: false, error: "Feast Guild membership is required." }, 403);
  }

  const { projectId } = await context.params;
  let input: ProjectTaskInput;
  try {
    input = await request.json() as ProjectTaskInput;
  } catch {
    return privateJson({ ok: false, error: "Project task must be valid JSON." }, 400);
  }

  const title = optionalText(input.title);
  const dueDate = optionalDate(input.dueDate);
  const note = optionalText(input.note);
  if (!title) return privateJson({ ok: false, error: "Task title is required." }, 400);
  if (dueDate === undefined) return privateJson({ ok: false, error: "Due date must use YYYY-MM-DD." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const effectiveAccountId = effectiveOperatorAccountId(operatorContext);
  const supabase = await createAtlasServerClient();
  const { data, error } = effectiveAccountId
    ? await supabase.rpc("owner_operator_create_project_task_v1", {
        p_effective_account_id: effectiveAccountId,
        p_project_id: projectId,
        p_title: title,
        p_due_date: dueDate,
        p_note: note,
      })
    : await supabase.rpc("create_project_task_v1", {
        p_project_id: projectId,
        p_title: title,
        p_due_date: dueDate,
        p_note: note,
      });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
    return privateJson({ ok: false, error: error.message || "Project task creation failed." }, status);
  }

  return privateJson({
    ok: true,
    taskId: data,
    operatorMode: Boolean(effectiveAccountId),
    effectiveAccountId,
  }, 201);
}
