import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  note?: string;
  laneKey?: string;
};

type TaskRow = {
  id: string;
  note: string | null;
  metadata: Record<string, unknown> | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const taskId = clean(body.taskId);
    const note = clean(body.note);

    if (!taskId) return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 });
    if (!note) return NextResponse.json({ ok: false, error: "Note is required." }, { status: 400 });

    const { data: taskData, error: taskError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, note, metadata")
      .eq("id", taskId)
      .single();

    if (taskError || !taskData) throw new Error(taskError?.message || "Task was not found.");

    const task = taskData as TaskRow;
    const now = new Date().toISOString();
    const line = `${now.slice(0, 10)} · ${note}`;
    const nextNote = [task.note, line].filter(Boolean).join("\n");
    const metadata = {
      ...(task.metadata ?? {}),
      last_task_note: {
        note,
        lane_key: clean(body.laneKey) || null,
        recorded_at: now,
      },
    };

    const { error: updateError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .update({ note: nextNote, metadata, updated_at: now })
      .eq("id", task.id);

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true, taskId: task.id });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Atlas task note failed.", details: error instanceof Error ? error.message : "Unknown error." },
      { status: 500 },
    );
  }
}
