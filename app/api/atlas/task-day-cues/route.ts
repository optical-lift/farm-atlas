import { NextResponse } from "next/server";

import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function validUuid(value: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Atlas-Read-Path": "worker-task-day-cues-v1" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");
  const date = url.searchParams.get("date");
  if (!validUuid(taskId)) return privateJson({ ok: false, error: "A valid taskId is required." }, 400);
  if (!validDate(date)) return privateJson({ ok: false, error: "A valid date is required." }, 400);

  const supabase = await createAtlasServerClient();
  const result = await supabase.rpc("worker_task_day_cues_api_v1", { p_task_id: taskId, p_day: date });
  if (result.error) {
    const status = result.error.code === "42501" ? 403 : result.error.code === "22023" ? 400 : 500;
    return privateJson({ ok: false, error: status === 403 ? "Task cue access required." : "Atlas could not load task cues." }, status);
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    return privateJson({ ok: false, error: "Atlas returned invalid task cues." }, 500);
  }

  return privateJson({ ok: true, ...(result.data as Record<string, unknown>) });
}
