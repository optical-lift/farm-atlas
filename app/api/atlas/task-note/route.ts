import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { recordTaskTransition, resolveAtlasTaskId } from "@/lib/atlas/task-transition-server";

export const dynamic = "force-dynamic";

type Body = { taskId?: string; taskTitle?: string; note?: string; laneKey?: string; workKey?: string; idempotencyKey?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Body;
    const note = clean(body.note);
    if (!note) return NextResponse.json({ ok: false, error: "Note is required." }, { status: 400 });
    const taskId = await resolveAtlasTaskId(clean(body.taskId), clean(body.taskTitle));
    const result = await recordTaskTransition({
      taskId,
      transition: "note",
      idempotencyKey: clean(body.idempotencyKey) || clean(request.headers.get("x-idempotency-key")) || `legacy-note:${taskId}:${randomUUID()}`,
      note,
      laneKey: clean(body.laneKey) || null,
      workKey: clean(body.workKey) || null,
      payload: { adapter: "task-note" },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas task note failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
