import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { recordTaskTransition, resolveAtlasTaskId } from "@/lib/atlas/task-transition-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  taskTitle?: string;
  targetDate?: string;
  rescheduleMode?: string;
  reason?: string;
  laneKey?: string;
  workKey?: string;
  idempotencyKey?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Body;
    const targetDate = clean(body.targetDate);
    if (!validDate(targetDate)) return NextResponse.json({ ok: false, error: "Target date must use YYYY-MM-DD." }, { status: 400 });
    const taskId = await resolveAtlasTaskId(clean(body.taskId), clean(body.taskTitle));
    const result = await recordTaskTransition({
      taskId,
      transition: "rescheduled",
      idempotencyKey: clean(body.idempotencyKey) || clean(request.headers.get("x-idempotency-key")) || `legacy-reschedule:${taskId}:${randomUUID()}`,
      targetDate,
      reason: clean(body.reason) || null,
      laneKey: clean(body.laneKey) || null,
      workKey: clean(body.workKey) || null,
      payload: { adapter: "task-reschedule", rescheduleMode: clean(body.rescheduleMode) || null },
    });
    return NextResponse.json({ ok: true, targetDate, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas task reschedule failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
