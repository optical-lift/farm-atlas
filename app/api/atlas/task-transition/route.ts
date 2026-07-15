import { NextRequest, NextResponse } from "next/server";
import {
  atlasTaskTransitions,
  recordTaskTransition,
  type AtlasTaskTransition,
} from "@/lib/atlas/task-transition-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: unknown;
  transition?: unknown;
  idempotencyKey?: unknown;
  targetDate?: unknown;
  note?: unknown;
  reason?: unknown;
  laneKey?: unknown;
  workKey?: unknown;
  payload?: unknown;
  existingFieldLogId?: unknown;
};

const transitionSet = new Set<string>(atlasTaskTransitions);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function objectPayload(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: NextRequest) {
  try {
    const requestOrigin = request.headers.get("origin");
    if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, error: "Task transitions require a same-origin request." }, { status: 403 });
    }
    if (request.headers.get("x-atlas-intent") !== "task-transition-v1") {
      return NextResponse.json({ ok: false, error: "Missing Atlas task-transition intent." }, { status: 403 });
    }

    const body = await request.json() as Body;
    const taskId = clean(body.taskId);
    const transition = clean(body.transition);
    const idempotencyKey = clean(body.idempotencyKey);
    const targetDate = clean(body.targetDate) || null;
    const note = clean(body.note) || null;
    const reason = clean(body.reason) || null;
    const laneKey = clean(body.laneKey) || null;
    const workKey = clean(body.workKey) || null;
    const existingFieldLogId = clean(body.existingFieldLogId) || null;
    const payload = body.payload === undefined ? {} : objectPayload(body.payload);
    const nextDayIntent = payload?.scheduleIntent === "next_day";

    if (!uuidPattern.test(taskId)) return NextResponse.json({ ok: false, error: "A valid task id is required." }, { status: 400 });
    if (!transitionSet.has(transition)) return NextResponse.json({ ok: false, error: "Unsupported task transition." }, { status: 400 });
    if (!idempotencyKey || idempotencyKey.length > 160) return NextResponse.json({ ok: false, error: "A valid idempotency key is required." }, { status: 400 });
    if (targetDate && !validDate(targetDate)) return NextResponse.json({ ok: false, error: "Target date must use YYYY-MM-DD." }, { status: 400 });
    if ((transition === "rescheduled" || transition === "unfinished") && !targetDate && !nextDayIntent) return NextResponse.json({ ok: false, error: "This transition requires a target date or supported scheduling intent." }, { status: 400 });
    if (nextDayIntent && transition !== "rescheduled") return NextResponse.json({ ok: false, error: "Next-day scheduling is only valid for rescheduled tasks." }, { status: 400 });
    if (note && note.length > 4000) return NextResponse.json({ ok: false, error: "Note must be 4000 characters or fewer." }, { status: 400 });
    if (existingFieldLogId && !uuidPattern.test(existingFieldLogId)) return NextResponse.json({ ok: false, error: "Existing field log id is invalid." }, { status: 400 });
    if (!payload) return NextResponse.json({ ok: false, error: "Task transition payload must be an object." }, { status: 400 });

    const result = await recordTaskTransition({
      taskId,
      transition: transition as AtlasTaskTransition,
      idempotencyKey,
      targetDate,
      note,
      reason,
      laneKey,
      workKey,
      payload,
      existingFieldLogId,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Atlas task transition failed.", details: error instanceof Error ? error.message : "Unknown error." },
      { status: 500 },
    );
  }
}
