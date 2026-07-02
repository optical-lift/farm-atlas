import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type TaskResult = "done" | "partial" | "changed" | "blocked" | "needs_supplies";

type TaskResultPayload = {
  taskId?: string;
  result?: TaskResult;
  note?: string;
  createdBy?: string;
};

function resultLabel(result: TaskResult) {
  switch (result) {
    case "done":
      return "completed";
    case "partial":
      return "made progress on";
    case "changed":
      return "changed plan/data for";
    case "blocked":
      return "blocked";
    case "needs_supplies":
      return "needs supplies for";
    default:
      return "updated";
  }
}

function actionTypesForResult(result: TaskResult) {
  switch (result) {
    case "done":
      return ["completed"];
    case "partial":
      return ["observed"];
    case "changed":
      return ["observed", "changed_plan"];
    case "blocked":
      return ["blocked"];
    case "needs_supplies":
      return ["blocked", "observed"];
    default:
      return ["observed"];
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TaskResultPayload;

    const taskId = body.taskId;
    const result = body.result;
    const note = body.note?.trim() || null;
    const createdBy = body.createdBy?.trim() || "anna";

    if (!taskId || !result) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing taskId or result.",
        },
        { status: 400 },
      );
    }

    const { data: task, error: taskError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select(
        `
        id,
        farm_id,
        zone_id,
        title,
        task_type,
        status,
        due_date,
        unlock_text,
        note
      `,
      )
      .eq("id", taskId)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        {
          ok: false,
          error: "Atlas task not found.",
          details: taskError?.message,
        },
        { status: 404 },
      );
    }

    const nowIso = new Date().toISOString();
    const todayIso = nowIso.slice(0, 10);

    if (result === "done") {
      const { error } = await atlasSupabase
        .schema("atlas")
        .from("tasks")
        .update({
          status: "done",
          completed_at: nowIso,
          completed_by: createdBy,
          updated_at: nowIso,
        })
        .eq("id", taskId);

      if (error) throw error;

      const { error: stepError } = await atlasSupabase
        .schema("atlas")
        .from("project_steps")
        .update({
          status: "done",
          completed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("linked_task_id", taskId);

      if (stepError) throw stepError;
    }

    if (result === "blocked" || result === "needs_supplies") {
      const { error } = await atlasSupabase
        .schema("atlas")
        .from("tasks")
        .update({
          status: "blocked",
          blocker_text:
            result === "needs_supplies"
              ? note || "Needs supplies before this task can be completed."
              : note || "Blocked from task card.",
          updated_at: nowIso,
        })
        .eq("id", taskId);

      if (error) throw error;

      const { error: stepError } = await atlasSupabase
        .schema("atlas")
        .from("project_steps")
        .update({
          status: "blocked",
          note:
            result === "needs_supplies"
              ? note || "Needs supplies before this step can continue."
              : note || "Blocked from task card.",
          updated_at: nowIso,
        })
        .eq("linked_task_id", taskId);

      if (stepError) throw stepError;
    }

    if (result === "partial" || result === "changed") {
      const { error } = await atlasSupabase
        .schema("atlas")
        .from("tasks")
        .update({
          updated_at: nowIso,
        })
        .eq("id", taskId);

      if (error) throw error;
    }

    let supplyTaskId: string | null = null;

    if (result === "needs_supplies") {
      const { data: supplyTask, error: supplyTaskError } = await atlasSupabase
        .schema("atlas")
        .from("tasks")
        .insert({
          farm_id: task.farm_id,
          zone_id: task.zone_id,
          title: `Get supplies for: ${task.title}`,
          task_type: "resource_check",
          status: "open",
          priority: "high",
          due_date: todayIso,
          unlock_text: `Unblocks: ${task.title}`,
          generated_from: "task_result",
          generated_from_id: taskId,
          note: note || "Created from Need supplies on a task card.",
          metadata: {
            source_task_id: taskId,
            source_task_title: task.title,
            task_result: result,
          },
        })
        .select("id")
        .single();

      if (supplyTaskError) throw supplyTaskError;

      supplyTaskId = supplyTask.id;
    }

    const summarySentence = `${todayIso} · ${createdBy} ${resultLabel(result)} "${task.title}"${
      note ? ` · ${note}` : ""
    }.`;

    const { data: fieldLog, error: logError } = await atlasSupabase
      .schema("atlas")
      .from("field_logs")
      .insert({
        farm_id: task.farm_id,
        log_date: todayIso,
        action_types: actionTypesForResult(result),
        summary_sentence: summarySentence,
        note,
        created_by: createdBy,
        source: "atlas_task_card",
        metadata: {
          task_id: taskId,
          task_title: task.title,
          task_result: result,
          generated_supply_task_id: supplyTaskId,
        },
      })
      .select("id")
      .single();

    if (logError) throw logError;

    const { data: taskObjects, error: taskObjectsError } = await atlasSupabase
      .schema("atlas")
      .from("task_objects")
      .select("object_id")
      .eq("task_id", taskId);

    if (taskObjectsError) throw taskObjectsError;

    const fieldLogLinks = [
      ...(task.zone_id
        ? [
            {
              field_log_id: fieldLog.id,
              zone_id: task.zone_id,
              object_id: null,
              role: "task_zone",
            },
          ]
        : []),
      ...(taskObjects ?? []).map((object) => ({
        field_log_id: fieldLog.id,
        zone_id: task.zone_id,
        object_id: object.object_id,
        role: "task_object",
      })),
    ];

    if (fieldLogLinks.length > 0) {
      const { error: linkError } = await atlasSupabase
        .schema("atlas")
        .from("field_log_objects")
        .insert(fieldLogLinks);

      if (linkError) throw linkError;
    }

    return NextResponse.json({
      ok: true,
      taskId,
      result,
      fieldLogId: fieldLog.id,
      generatedSupplyTaskId: supplyTaskId,
    });
  } catch (error) {
    console.error("Atlas task result failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Atlas task result failed.",
        details:
          error instanceof Error ? error.message : "Unknown task-result error.",
      },
      { status: 500 },
    );
  }
}
