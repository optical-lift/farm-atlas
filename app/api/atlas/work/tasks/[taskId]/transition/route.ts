import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { isValidAtlasTaskId } from "@/lib/atlas/task-routing-core.js";
import { validateAtlasTransitionRequest } from "@/lib/atlas/task-transition-validation-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const WORKER_TRANSITIONS = new Set(["done", "blocked", "note"]);

type Body = {
  transition?: unknown;
  idempotencyKey?: unknown;
  note?: unknown;
  reason?: unknown;
  payload?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectPayload(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await getAtlasSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (!session.memberships.some((membership) => membership.role === "farm_hand")) {
    return NextResponse.json(
      { ok: false, error: "Farm-Hand membership required." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { taskId } = await params;
  if (!isValidAtlasTaskId(taskId)) {
    return NextResponse.json({ ok: false, error: "Task not found." }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid task result." }, { status: 400 });
  }

  const transition = clean(body.transition);
  const idempotencyKey = clean(body.idempotencyKey);
  const note = clean(body.note) || null;
  const reason = clean(body.reason) || null;
  const payload = body.payload === undefined ? {} : objectPayload(body.payload);

  if (transition === "blocked" && !reason) {
    return NextResponse.json(
      { ok: false, error: "Describe what is blocking the task." },
      { status: 400 },
    );
  }

  const validationError = validateAtlasTransitionRequest({
    requestOrigin: request.headers.get("origin"),
    expectedOrigin: request.nextUrl.origin,
    intent: request.headers.get("x-atlas-intent"),
    taskId,
    transition,
    supportedTransitions: WORKER_TRANSITIONS,
    idempotencyKey,
    targetDate: null,
    note,
    payload,
    existingFieldLogId: null,
  });

  if (validationError) {
    return NextResponse.json(
      { ok: false, error: validationError.error },
      { status: validationError.status },
    );
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_record_task_transition_v1", {
    p_task_id: taskId,
    p_transition: transition,
    p_idempotency_key: idempotencyKey,
    p_note: note,
    p_reason: reason,
    p_payload: payload ?? {},
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "This task is not available to the signed-in Farm Hand." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, result: data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
