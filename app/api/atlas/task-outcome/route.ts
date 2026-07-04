import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Outcome = "done" | "partial" | "blocked";

type Body = {
  taskId?: string;
  taskTitle?: string;
  outcome?: Outcome;
  note?: string;
  reason?: string;
  laneKey?: string;
  workKey?: string;
};

type TaskRow = {
  id: string;
  farm_id: string;
  zone_id: string | null;
  title: string;
  task_type: string | null;
  status: string;
  priority: string | null;
  due_date: string | null;
  blocker_text: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nextStatus(outcome: Outcome) {
  if (outcome === "done") return "done";
  if (outcome === "blocked") return "blocked";
  return "open";
}

async function getTask(body: Body) {
  if (body.taskId) {
    const { data, error } = await atlasSupabase.schema("atlas").from("tasks").select("id, farm_id, zone_id, title, task_type, status, priority, due_date, blocker_text, note, metadata").eq("id", body.taskId).single();
    if (error || !data) throw new Error(error?.message || "Task was not found.");
    return data as TaskRow;
  }

  const title = clean(body.taskTitle);
  if (!title) throw new Error("Task title is required.");
  const { data, error } = await atlasSupabase.schema("atlas").from("tasks").select("id, farm_id, zone_id, title, task_type, status, priority, due_date, blocker_text, note, metadata").ilike("title", title).in("status", ["open", "blocked"]).order("due_date", { ascending: true }).limit(1);
  if (error) throw new Error(error.message);
  if (!data?.[0]) throw new Error("No matching open task was found.");
  return data[0] as TaskRow;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const outcome = body.outcome;
    if (outcome !== "done" && outcome !== "partial" && outcome !== "blocked") {
      return NextResponse.json({ ok: false, error: "Outcome must be done, partial, or blocked." }, { status: 400 });
    }

    const task = await getTask(body);
    const now = new Date().toISOString();
    const note = clean(body.note) || null;
    const reason = clean(body.reason) || null;
    const metadata = {
      ...(task.metadata ?? {}),
      last_outcome: {
        outcome,
        reason,
        note,
        lane_key: clean(body.laneKey) || null,
        work_key: clean(body.workKey) || null,
        recorded_at: now,
      },
      outcome_history_count: typeof task.metadata?.outcome_history_count === "number" ? task.metadata.outcome_history_count + 1 : 1,
    };

    const updatePayload: Record<string, unknown> = { status: nextStatus(outcome), metadata, updated_at: now };
    if (outcome === "done") updatePayload.completed_at = now;
    if (outcome === "partial" && note) updatePayload.note = [task.note, note].filter(Boolean).join("\n");
    if (outcome === "blocked") updatePayload.blocker_text = reason || note || task.blocker_text || "blocked";

    const { error: updateError } = await atlasSupabase.schema("atlas").from("tasks").update(updatePayload).eq("id", task.id);
    if (updateError) throw new Error(updateError.message);

    const { error: eventError } = await atlasSupabase.schema("atlas").from("task_outcome_events").insert({
      farm_id: task.farm_id,
      task_id: task.id,
      outcome,
      lane_key: clean(body.laneKey) || null,
      work_key: clean(body.workKey) || null,
      blocker_reason: reason,
      note,
      task_title: task.title,
      task_type: task.task_type,
      zone_id: task.zone_id,
      due_date: task.due_date,
      priority: task.priority,
      source: "atlas_task_outcome",
      metadata: { prior_status: task.status },
    });
    if (eventError) throw new Error(eventError.message);

    return NextResponse.json({ ok: true, taskId: task.id, outcome, status: nextStatus(outcome) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas task outcome failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
