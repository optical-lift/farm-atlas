import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  recordTaskTransition,
  resolveAtlasTaskId,
  type AtlasTaskTransition,
} from "@/lib/atlas/task-transition-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  taskTitle?: string;
  outcome?: AtlasTaskTransition;
  note?: string;
  reason?: string;
  laneKey?: string;
  workKey?: string;
  idempotencyKey?: string;
};

const outcomes = new Set<AtlasTaskTransition>(["done", "partial", "blocked", "not_relevant", "changed_plan"]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Body;
    if (!body.outcome || !outcomes.has(body.outcome)) {
      return NextResponse.json({ ok: false, error: "Unsupported task outcome." }, { status: 400 });
    }
    const taskId = await resolveAtlasTaskId(clean(body.taskId), clean(body.taskTitle));
    const result = await recordTaskTransition({
      taskId,
      transition: body.outcome,
      idempotencyKey: clean(body.idempotencyKey) || clean(request.headers.get("x-idempotency-key")) || `legacy-outcome:${taskId}:${randomUUID()}`,
      note: clean(body.note) || null,
      reason: clean(body.reason) || null,
      laneKey: clean(body.laneKey) || null,
      workKey: clean(body.workKey) || null,
      payload: { adapter: "task-outcome" },
    });
    return NextResponse.json({ ok: true, outcome: body.outcome, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas task outcome failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
