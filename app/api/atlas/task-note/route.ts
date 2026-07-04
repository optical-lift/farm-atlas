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
  farm_id: string;
  zone_id: string | null;
  title: string;
  task_type: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
};

type ObjectStateRow = {
  object_id: string;
  metadata: Record<string, unknown> | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function getTaskObjectIds(taskId: string) {
  const { data, error } = await atlasSupabase.schema("atlas").from("task_objects").select("object_id").eq("task_id", taskId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.object_id as string).filter(Boolean);
}

async function updateObjectNotes(task: TaskRow, objectIds: string[], note: string, laneKey: string | null, now: string) {
  if (objectIds.length === 0) return;
  const { data, error } = await atlasSupabase.schema("atlas").from("object_state").select("object_id, metadata").in("object_id", objectIds);
  if (error) throw new Error(error.message);
  const existing = new Map((data ?? []).map((row) => [(row as ObjectStateRow).object_id, (row as ObjectStateRow).metadata ?? {}]));

  const rows = objectIds.map((objectId) => ({
    object_id: objectId,
    farm_id: task.farm_id,
    last_touched_at: now.slice(0, 10),
    metadata: {
      ...(existing.get(objectId) ?? {}),
      last_task_note: {
        task_id: task.id,
        task_title: task.title,
        note,
        lane_key: laneKey,
        recorded_at: now,
      },
    },
    updated_at: now,
  }));

  const { error: upsertError } = await atlasSupabase.schema("atlas").from("object_state").upsert(rows, { onConflict: "object_id" });
  if (upsertError) throw new Error(upsertError.message);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const taskId = clean(body.taskId);
    const note = clean(body.note);
    const laneKey = clean(body.laneKey) || null;

    if (!taskId) return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 });
    if (!note) return NextResponse.json({ ok: false, error: "Note is required." }, { status: 400 });

    const { data: taskData, error: taskError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, farm_id, zone_id, title, task_type, note, metadata")
      .eq("id", taskId)
      .single();

    if (taskError || !taskData) throw new Error(taskError?.message || "Task was not found.");

    const task = taskData as TaskRow;
    const now = new Date().toISOString();
    const objectIds = await getTaskObjectIds(task.id);
    const line = `${now.slice(0, 10)} · ${note}`;
    const nextNote = [task.note, line].filter(Boolean).join("\n");
    const metadata = {
      ...(task.metadata ?? {}),
      last_task_note: {
        note,
        lane_key: laneKey,
        object_ids: objectIds,
        recorded_at: now,
      },
    };

    const { error: updateError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .update({ note: nextNote, metadata, updated_at: now })
      .eq("id", task.id);

    if (updateError) throw new Error(updateError.message);

    const { error: logError } = await atlasSupabase.schema("atlas").from("field_logs").insert({
      farm_id: task.farm_id,
      log_date: now.slice(0, 10),
      action_types: ["task_note", laneKey, task.task_type].filter(Boolean),
      summary_sentence: `${task.title} · note`,
      note,
      source: "atlas_task_board",
      metadata: {
        task_id: task.id,
        task_title: task.title,
        lane_key: laneKey,
        object_ids: objectIds,
      },
    });
    if (logError) throw new Error(logError.message);

    await updateObjectNotes(task, objectIds, note, laneKey, now);

    return NextResponse.json({ ok: true, taskId: task.id });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Atlas task note failed.", details: error instanceof Error ? error.message : "Unknown error." },
      { status: 500 },
    );
  }
}
