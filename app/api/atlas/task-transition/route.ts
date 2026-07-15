import { NextRequest, NextResponse } from "next/server";
import {
  atlasTaskTransitions,
  recordTaskTransition,
  type AtlasTaskTransition,
} from "@/lib/atlas/task-transition-server";
import { validateAtlasTransitionRequest } from "@/lib/atlas/task-transition-validation-core.js";

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

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectPayload(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: NextRequest) {
  try {
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

    const validationError = validateAtlasTransitionRequest({
      requestOrigin: request.headers.get("origin"),
      expectedOrigin: request.nextUrl.origin,
      intent: request.headers.get("x-atlas-intent"),
      taskId,
      transition,
      supportedTransitions: transitionSet,
      idempotencyKey,
      targetDate,
      note,
      payload,
      existingFieldLogId,
    });
    if (validationError) return NextResponse.json({ ok: false, error: validationError.error }, { status: validationError.status });

    const result = await recordTaskTransition({
      taskId,
      transition: transition as AtlasTaskTransition,
      idempotencyKey,
      targetDate,
      note,
      reason,
      laneKey,
      workKey,
      payload: payload ?? {},
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
