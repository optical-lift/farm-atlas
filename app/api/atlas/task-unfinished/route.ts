import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";
import { recordTaskTransition, resolveAtlasTaskId } from "@/lib/atlas/task-transition-server";

export const dynamic = "force-dynamic";

type Body = { taskId?: string; taskTitle?: string; laneKey?: string; workKey?: string; idempotencyKey?: string };
type TaskRow = { id: string; farm_id: string; task_type: string | null; action_key: string | null; due_date: string | null; metadata: Record<string, unknown> | null };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function chicagoToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function actionKey(task: TaskRow) {
  return clean(task.action_key) || clean(task.metadata?.work_route) || clean(task.task_type) || "general";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Body;
    const taskId = await resolveAtlasTaskId(clean(body.taskId), clean(body.taskTitle));
    const { data: taskData, error: taskError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, farm_id, task_type, action_key, due_date, metadata")
      .eq("id", taskId)
      .single();
    if (taskError || !taskData) throw new Error(taskError?.message || "Task was not found.");
    const task = taskData as TaskRow;
    const tomorrow = addDays(chicagoToday(), 1);
    const { data: candidates, error: candidateError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, farm_id, task_type, action_key, due_date, metadata")
      .eq("farm_id", task.farm_id)
      .in("status", ["open", "blocked"])
      .gte("due_date", tomorrow)
      .order("due_date", { ascending: true })
      .limit(100);
    if (candidateError) throw new Error(candidateError.message);
    const targetDate = ((candidates ?? []) as TaskRow[]).find((candidate) => candidate.id !== task.id && actionKey(candidate) === actionKey(task))?.due_date ?? tomorrow;

    const result = await recordTaskTransition({
      taskId,
      transition: "unfinished",
      idempotencyKey: clean(body.idempotencyKey) || clean(request.headers.get("x-idempotency-key")) || `legacy-unfinished:${taskId}:${randomUUID()}`,
      targetDate,
      reason: "Unfinished",
      laneKey: clean(body.laneKey) || null,
      workKey: clean(body.workKey) || actionKey(task),
      payload: { adapter: "task-unfinished" },
    });
    return NextResponse.json({ ok: true, dueDate: targetDate, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas unfinished failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
