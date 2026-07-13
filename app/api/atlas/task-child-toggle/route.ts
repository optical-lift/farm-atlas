import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";
import { recordTaskTransition } from "@/lib/atlas/task-transition-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  checklistStatus?: "open" | "done";
  plantedAmount?: number | string | null;
  plantedLocation?: string | null;
  plantedZoneId?: string | null;
  plantedObjectId?: string | null;
  idempotencyKey?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Body;
    const taskId = clean(body.taskId);
    if (!taskId) return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 });
    if (body.checklistStatus !== "open" && body.checklistStatus !== "done") {
      return NextResponse.json({ ok: false, error: "Checklist status must be open or done." }, { status: 400 });
    }

    const transition = body.checklistStatus === "done" ? "checklist_done" : "checklist_open";
    const result = await recordTaskTransition({
      taskId,
      transition,
      idempotencyKey: clean(body.idempotencyKey) || clean(request.headers.get("x-idempotency-key")) || `legacy-checklist:${taskId}:${randomUUID()}`,
      laneKey: "checklist",
      workKey: body.checklistStatus === "done" ? "checked" : "reopened",
      payload: {
        adapter: "task-child-toggle",
        completion_source: "checklist",
        plantedAmount: body.plantedAmount ?? null,
        plantedLocation: clean(body.plantedLocation) || null,
        plantedZoneId: clean(body.plantedZoneId) || null,
        plantedObjectId: clean(body.plantedObjectId) || null,
      },
    });

    const { data: task } = await atlasSupabase.schema("atlas").from("tasks").select("metadata").eq("id", taskId).single();
    const metadata = task?.metadata && typeof task.metadata === "object" ? task.metadata as Record<string, unknown> : {};
    return NextResponse.json({ ok: true, checklistStatus: body.checklistStatus, plantingLog: metadata.planting_log ?? null, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas checklist failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
