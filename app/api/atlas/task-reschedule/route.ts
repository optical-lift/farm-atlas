import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  targetDate?: string;
  reason?: string;
  rescheduleMode?: string;
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
  note: string | null;
  metadata: Record<string, unknown> | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const taskId = clean(body.taskId);
    const targetDate = clean(body.targetDate);
    const reason = clean(body.reason) || null;
    const rescheduleMode = clean(body.rescheduleMode) || "manual";
    const laneKey = clean(body.laneKey) || null;
    const workKey = clean(body.workKey) || null;

    if (!taskId) {
      return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 });
    }

    if (!validDate(targetDate)) {
      return NextResponse.json({ ok: false, error: "A valid target date is required." }, { status: 400 });
    }

    const { data, error } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, farm_id, zone_id, title, task_type, status, priority, due_date, note, metadata")
      .eq("id", taskId)
      .single();

    if (error || !data) throw new Error(error?.message || "Task was not found.");

    const task = data as TaskRow;
    const now = new Date().toISOString();
    const metadata = {
      ...(task.metadata ?? {}),
      last_reschedule: {
        from_due_date: task.due_date,
        to_due_date: targetDate,
        reason,
        mode: rescheduleMode,
        lane_key: laneKey,
        work_key: workKey,
        recorded_at: now,
      },
      reschedule_count: typeof task.metadata?.reschedule_count === "number" ? task.metadata.reschedule_count + 1 : 1,
    };

    const { error: updateError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .update({ status: "open", due_date: targetDate, blocker_text: null, metadata, updated_at: now })
      .eq("id", task.id);

    if (updateError) throw new Error(updateError.message);

    const logSummary = [task.title, `rescheduled to ${targetDate}`, reason].filter(Boolean).join(" · ");
    const { error: logError } = await atlasSupabase.schema("atlas").from("field_logs").insert({
      farm_id: task.farm_id,
      log_date: now.slice(0, 10),
      action_types: Array.from(new Set(["task_rescheduled", laneKey, workKey, task.task_type].filter(Boolean) as string[])),
      summary_sentence: logSummary,
      note: reason,
      source: "atlas_task_board",
      metadata: {
        task_id: task.id,
        task_title: task.title,
        outcome: "rescheduled",
        reschedule_mode: rescheduleMode,
        prior_due_date: task.due_date,
        target_date: targetDate,
        lane_key: laneKey,
        work_key: workKey,
      },
    });

    if (logError) throw new Error(logError.message);

    return NextResponse.json({ ok: true, taskId: task.id, targetDate, status: "open" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas task reschedule failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
