import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  taskTitle?: string;
  laneKey?: string;
  workKey?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function findTask(body: Body) {
  if (body.taskId) {
    const { data, error } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, farm_id, zone_id, title, task_type, status, priority, due_date, metadata")
      .eq("id", body.taskId)
      .single();
    if (error || !data) throw new Error(error?.message || "Task was not found.");
    return data;
  }

  const title = clean(body.taskTitle);
  if (!title) throw new Error("Task is required.");
  const pattern = title.includes("%") ? title : `%${title}%`;
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id, farm_id, zone_id, title, task_type, status, priority, due_date, metadata")
    .ilike("title", pattern)
    .in("status", ["open", "blocked"])
    .order("due_date", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data?.[0]) throw new Error("No matching open task was found.");
  return data[0];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const task = await findTask(body);
    const now = new Date().toISOString();
    const tomorrow = tomorrowIso();
    const laneKey = clean(body.laneKey) || null;
    const workKey = clean(body.workKey) || "unfinished";

    const { data: childTasks, error: childError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, metadata")
      .eq("metadata->>parent_task_id", task.id)
      .neq("status", "archived");
    if (childError) throw new Error(childError.message);

    const remainingChildIds = (childTasks ?? [])
      .filter((child) => ((child.metadata as Record<string, unknown> | null)?.checklist_status ?? "open") !== "done")
      .map((child) => child.id as string);

    const metadata = {
      ...((task.metadata as Record<string, unknown> | null) ?? {}),
      last_outcome: {
        outcome: "unfinished",
        reason: "Unfinished",
        moved_to: tomorrow,
        lane_key: laneKey,
        work_key: workKey,
        remaining_child_task_ids: remainingChildIds,
        recorded_at: now,
      },
    };

    const { error: updateError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .update({ status: "open", due_date: tomorrow, metadata, updated_at: now })
      .eq("id", task.id);
    if (updateError) throw new Error(updateError.message);

    if (remainingChildIds.length > 0) {
      const { error: childMoveError } = await atlasSupabase
        .schema("atlas")
        .from("tasks")
        .update({ due_date: tomorrow, updated_at: now })
        .in("id", remainingChildIds);
      if (childMoveError) throw new Error(childMoveError.message);
    }

    await atlasSupabase.schema("atlas").from("task_outcome_events").insert({
      farm_id: task.farm_id,
      task_id: task.id,
      outcome: "partial",
      lane_key: laneKey,
      work_key: workKey,
      note: `Unfinished — moved to ${tomorrow}`,
      task_title: task.title,
      task_type: task.task_type,
      zone_id: task.zone_id,
      due_date: task.due_date,
      priority: task.priority,
      source: "atlas_task_unfinished",
      metadata: { moved_to: tomorrow, prior_status: task.status, remaining_child_task_ids: remainingChildIds },
    });

    return NextResponse.json({ ok: true, taskId: task.id, dueDate: tomorrow, remainingChildTaskIds: remainingChildIds });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas unfinished failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
