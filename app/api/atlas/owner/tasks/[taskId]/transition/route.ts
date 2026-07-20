import { NextRequest, NextResponse } from "next/server";

import { getAuthorizedOwnerTaskById } from "@/lib/atlas-data/owner-task-detail";
import { ownerMembershipForTask } from "@/lib/atlas/owner-task-access-core.js";
import { getAtlasSession } from "@/lib/atlas/session";
import {
  recordTaskTransition,
  type AtlasTaskTransition,
} from "@/lib/atlas/task-transition-server";
import { validateAtlasTransitionRequest } from "@/lib/atlas/task-transition-validation-core.js";

export const dynamic = "force-dynamic";

const OWNER_TRANSITIONS = new Set(["done", "blocked", "rescheduled", "note"]);

type Body = {
  transition?: unknown;
  idempotencyKey?: unknown;
  targetDate?: unknown;
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

  const { taskId } = await params;
  const task = await getAuthorizedOwnerTaskById(taskId);
  const ownerMembership = ownerMembershipForTask(session, task);

  if (!task || !ownerMembership) {
    return NextResponse.json(
      { ok: false, error: "Task not found." },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid task action." }, { status: 400 });
  }

  const transition = clean(body.transition);
  const idempotencyKey = clean(body.idempotencyKey);
  const targetDate = clean(body.targetDate) || null;
  const note = clean(body.note) || null;
  const reason = clean(body.reason) || null;
  const payload = body.payload === undefined ? {} : objectPayload(body.payload);

  const validationError = validateAtlasTransitionRequest({
    requestOrigin: request.headers.get("origin"),
    expectedOrigin: request.nextUrl.origin,
    intent: request.headers.get("x-atlas-intent"),
    taskId,
    transition,
    supportedTransitions: OWNER_TRANSITIONS,
    idempotencyKey,
    targetDate,
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

  try {
    const result = await recordTaskTransition({
      taskId,
      transition: transition as AtlasTaskTransition,
      idempotencyKey,
      targetDate,
      note,
      reason,
      payload: {
        ...(payload ?? {}),
        actor_user_id: session.userId,
        actor_membership_id: ownerMembership.membershipId,
        actor_role: "owner",
      },
    });

    return NextResponse.json(
      { ok: true, result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Atlas could not apply that Owner action." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
