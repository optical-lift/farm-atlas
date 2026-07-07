import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  taskTitle?: string;
  laneKey?: string;
  workKey?: string;
};

type TaskRow = {
  id: string;
  farm_id: string;
  zone_id: string | null;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  metadata: Record<string, unknown> | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function taskRoute(task: Pick<TaskRow, "title" | "task_type" | "metadata">) {
  const explicit = clean(task.metadata?.work_route).toLowerCase();
  if (explicit) return explicit;

  const text = `${task.task_type ?? ""} ${task.title ?? ""} ${clean(task.metadata?.work_rhythm)} ${clean(task.metadata?.display_action)}`.toLowerCase();
  if (text.includes("water")) return "water";
  if (text.includes("mow")) return "mow";
  if (text.includes("weed")) return "weed";
  if (text.includes("seed") || text.includes("sow")) return "seed";
  if (text.includes("harvest") || text.includes("postharvest") || text.includes("garlic") || text.includes("gather")) return "harvest";
  if (text.includes("venue") || text.includes("paint") || text.includes("trim") || text.includes("tidy") || text.includes("chicken")) return "venue";
  if (text.includes("build") || text.includes("prep") || text.includes("string") || text.includes("arch")) return "build";
  if (text.includes("plant") || text.includes("transplant")) return "plant";
  return "task";
}

function isChildTask(task: Pick<TaskRow, "metadata">) {
  return task.metadata?.is_child_task === true || task.metadata?.is_child_task === "true";
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
    return data as TaskRow;
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
  return data[0] as TaskRow;
}

async function nextSlotForTask(task: TaskRow) {
  const today = todayIso();
  const tomorrow = addDaysIso(today, 1);
  const route = taskRoute(task);

  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id, title, task_type, status, due_date, metadata")
    .eq("farm_id", task.farm_id)
    .in("status", ["open", "blocked"])
    .gte("due_date", tomorrow)
    .order("due_date", { ascending: true })
    .limit(75);
  if (error) throw new Error(error.message);

  const matching = ((data ?? []) as TaskRow[])
    .filter((candidate) => candidate.id !== task.id)
    .filter((candidate) => !isChildTask(candidate))
    .filter((candidate) => taskRoute(candidate) === route)
    .find((candidate) => Boolean(candidate.due_date));

  return matching?.due_date ?? tomorrow;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const task = await findTask(body);
    const now = new Date().toISOString();
    const targetDate = await nextSlotForTask(task);
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
        moved_to: targetDate,
        lane_key: laneKey,
        work_key: workKey,
        remaining_child_task_ids: remainingChildIds,
        recorded_at: now,
      },
    };

    const { error: updateError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .update({ status: "open", due_date: targetDate, metadata, updated_at: now })
      .eq("id", task.id);
    if (updateError) throw new Error(updateError.message);

    if (remainingChildIds.length > 0) {
      const { error: childMoveError } = await atlasSupabase
        .schema("atlas")
        .from("tasks")
        .update({ due_date: targetDate, updated_at: now })
        .in("id", remainingChildIds);
      if (childMoveError) throw new Error(childMoveError.message);
    }

    await atlasSupabase.schema("atlas").from("task_outcome_events").insert({
      farm_id: task.farm_id,
      task_id: task.id,
      outcome: "partial",
      lane_key: laneKey,
      work_key: workKey,
      note: `Unfinished — moved to ${targetDate}`,
      task_title: task.title,
      task_type: task.task_type,
      zone_id: task.zone_id,
      due_date: task.due_date,
      priority: task.priority,
      source: "atlas_task_unfinished",
      metadata: { moved_to: targetDate, prior_status: task.status, remaining_child_task_ids: remainingChildIds, route: taskRoute(task) },
    });

    return NextResponse.json({ ok: true, taskId: task.id, dueDate: targetDate, remainingChildTaskIds: remainingChildIds });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas unfinished failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
