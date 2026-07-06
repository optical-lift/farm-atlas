import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  checklistStatus?: "open" | "done";
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    if (!body.taskId) return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 });
    const checklistStatus = body.checklistStatus === "done" ? "done" : "open";
    const now = new Date().toISOString();

    const { data: task, error: taskError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, farm_id, title, task_type, zone_id, due_date, priority, metadata")
      .eq("id", body.taskId)
      .single();
    if (taskError || !task) throw new Error(taskError?.message || "Child task was not found.");

    const metadata = {
      ...((task.metadata as Record<string, unknown> | null) ?? {}),
      checklist_status: checklistStatus,
      checklist_completed_at: checklistStatus === "done" ? now : null,
    };

    const { error: updateError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .update({ status: "skipped", metadata, updated_at: now })
      .eq("id", body.taskId);
    if (updateError) throw new Error(updateError.message);

    await atlasSupabase.schema("atlas").from("task_outcome_events").insert({
      farm_id: task.farm_id,
      task_id: task.id,
      outcome: checklistStatus === "done" ? "done" : "partial",
      lane_key: "checklist",
      work_key: checklistStatus === "done" ? "checked" : "unchecked",
      note: checklistStatus === "done" ? "Checklist item done" : "Checklist item reopened",
      task_title: task.title,
      task_type: task.task_type,
      zone_id: task.zone_id,
      due_date: task.due_date,
      priority: task.priority,
      source: "atlas_child_checklist",
      metadata: { checklist_status: checklistStatus, parent_task_id: metadata.parent_task_id ?? null },
    });

    return NextResponse.json({ ok: true, taskId: task.id, checklistStatus });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas child checklist failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
