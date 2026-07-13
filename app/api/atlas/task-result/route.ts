import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";
import { recordTaskTransition, type AtlasTaskTransition } from "@/lib/atlas/task-transition-server";

export const dynamic = "force-dynamic";

type TaskResult = "done" | "partial" | "changed" | "blocked" | "needs_supplies";
type Capture = Record<string, string | undefined> & { kind?: string };
type Payload = { taskId?: string; result?: TaskResult; note?: string; createdBy?: string; objectId?: string; capture?: Capture };
type AnyObj = Record<string, unknown>;

function obj(value: unknown): AnyObj {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyObj) : {};
}

function actionTypes(result: TaskResult, capture?: Capture | null) {
  const set = new Set<string>();
  if (capture?.kind === "germination") set.add("germination_checked");
  if (capture?.kind === "weed") set.add("weeded");
  if (capture?.kind === "harvest") set.add("harvested");
  if (capture?.kind === "bed_audit") set.add("bed_audit");
  if (result === "done") set.add("completed");
  if (result === "partial") set.add("observed");
  if (result === "changed") { set.add("observed"); set.add("changed_plan"); }
  if (result === "blocked") set.add("blocked");
  if (result === "needs_supplies") { set.add("blocked"); set.add("observed"); }
  return Array.from(set);
}

function resultWord(result: TaskResult) {
  if (result === "done") return "completed";
  if (result === "partial") return "partly completed";
  if (result === "changed") return "changed";
  if (result === "blocked") return "blocked";
  return "needs supplies for";
}

function percent(value?: string) {
  const match = value?.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function germinationStatus(capture: Capture) {
  if (capture.standQuality === "failed") return "failed";
  if (capture.standQuality === "none") return "germination_check";
  return "germinating";
}

async function linkedObjects(taskId: string) {
  const { data, error } = await atlasSupabase.schema("atlas").from("task_objects").select("object_id").eq("task_id", taskId);
  if (error) throw error;
  return (data ?? []).map((row) => row.object_id as string).filter(Boolean);
}

async function createLinkedTask(args: { farmId: string; zoneId: string | null; objectId: string | null; sourceTaskId: string; title: string; taskType: string; dueDate: string; note: string | null; metadata: AnyObj }) {
  const { data, error } = await atlasSupabase.schema("atlas").from("tasks").insert({
    farm_id: args.farmId,
    zone_id: args.zoneId,
    title: args.title,
    task_type: args.taskType,
    status: "open",
    priority: "high",
    due_date: args.dueDate,
    generated_from: "task_result",
    generated_from_id: args.sourceTaskId,
    note: args.note,
    metadata: args.metadata,
  }).select("id").single();
  if (error) throw error;
  if (args.objectId) {
    const { error: linkError } = await atlasSupabase.schema("atlas").from("task_objects").insert({ task_id: data.id, object_id: args.objectId, role: "target" });
    if (linkError) throw linkError;
  }
  return data.id as string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Payload;
    const taskId = body.taskId;
    const result = body.result;
    const note = body.note?.trim() || null;
    const createdBy = body.createdBy?.trim() || "anna";
    const objectId = body.objectId || null;
    const capture = body.capture || null;

    if (!taskId || !result) return NextResponse.json({ ok: false, error: "Missing taskId or result." }, { status: 400 });

    const { data: task, error: taskError } = await atlasSupabase.schema("atlas").from("tasks").select("id, farm_id, zone_id, title, task_type, metadata").eq("id", taskId).single();
    if (taskError || !task) return NextResponse.json({ ok: false, error: "Atlas task not found.", details: taskError?.message }, { status: 404 });

    const nowIso = new Date().toISOString();
    const todayIso = nowIso.slice(0, 10);
    const taskObjectIds = await linkedObjects(taskId);
    const targetObjectId = objectId || taskObjectIds[0] || null;

    let objectLabel: string | null = null;
    let objectZoneId: string | null = task.zone_id ?? null;
    let contentId: string | null = null;
    let contentLabel: string | null = null;
    let followUpTaskId: string | null = null;

    if (capture && targetObjectId) {
      const { data: growingObject, error: objectError } = await atlasSupabase.schema("atlas").from("growing_objects").select("id, label, zone_id").eq("id", targetObjectId).single();
      if (objectError || !growingObject) throw objectError ?? new Error("Object not found.");
      objectLabel = growingObject.label;
      objectZoneId = growingObject.zone_id;

      const { data: content, error: contentError } = await atlasSupabase.schema("atlas").from("object_contents").select("id, content_label, status, germinated_date, metadata").eq("object_id", targetObjectId).order("planted_date", { ascending: false }).limit(1).maybeSingle();
      if (contentError) throw contentError;
      contentId = content?.id ?? null;
      contentLabel = content?.content_label ?? null;

      if (content) {
        const oldMetadata = obj(content.metadata);
        const stateChecks = obj(oldMetadata.state_checks);
        const nextMetadata = { ...oldMetadata, state_checks: { ...stateChecks, [capture.kind || "task_capture"]: { ...capture, checked_date: todayIso, created_by: createdBy, note, task_id: taskId } } };
        const update: AnyObj = { confidence: "observed", metadata: nextMetadata, updated_at: nowIso };
        if (capture.kind === "germination") {
          update.status = germinationStatus(capture);
          if (capture.standQuality !== "failed" && !content.germinated_date) update.germinated_date = todayIso;
        }
        if (capture.kind === "bed_audit" && capture.heading) update.next_crop_planned = capture.heading;
        const { error: updateError } = await atlasSupabase.schema("atlas").from("object_contents").update(update).eq("id", content.id);
        if (updateError) throw updateError;
      }

      const quantity = capture.kind === "harvest" ? percent(capture.stems) : percent(capture.standPercent);
      const { error: eventError } = await atlasSupabase.schema("atlas").from("object_activity_events").insert({
        farm_id: task.farm_id,
        object_id: targetObjectId,
        object_content_id: contentId,
        event_type: capture.kind === "germination" ? "germination_checked" : capture.kind || "task_capture",
        event_date: todayIso,
        note,
        quantity,
        unit: quantity === null ? null : capture.kind === "harvest" ? "stems" : "percent",
        created_by: createdBy,
        source: "atlas_task_card",
        metadata: { ...capture, task_id: taskId },
      });
      if (eventError) throw eventError;

      if (capture.kind === "germination" && (["patch_sow", "resow"].includes(capture.nextAction || "") || ["patchy", "poor"].includes(capture.standQuality || ""))) {
        followUpTaskId = await createLinkedTask({
          farmId: task.farm_id,
          zoneId: objectZoneId,
          objectId: targetObjectId,
          sourceTaskId: taskId,
          title: `${objectLabel} — patch ${contentLabel || "crop"}`,
          taskType: "patch_sow",
          dueDate: todayIso,
          note,
          metadata: { source_object_id: targetObjectId, source_content_id: contentId, reason: "germination_patch_needed", capture },
        });
      }
    }

    let supplyTaskId: string | null = null;
    if (result === "needs_supplies") {
      supplyTaskId = await createLinkedTask({
        farmId: task.farm_id,
        zoneId: objectZoneId,
        objectId: targetObjectId,
        sourceTaskId: taskId,
        title: objectLabel ? `${objectLabel} — get supplies` : `Get supplies for: ${task.title}`,
        taskType: "resource_check",
        dueDate: todayIso,
        note,
        metadata: { source_object_id: targetObjectId, reason: "needs_supplies", capture },
      });
    }

    const subject = objectLabel ? `${objectLabel} · ${task.title}` : task.title;
    const { data: fieldLog, error: logError } = await atlasSupabase.schema("atlas").from("field_logs").insert({
      farm_id: task.farm_id,
      log_date: todayIso,
      action_types: actionTypes(result, capture),
      summary_sentence: `${todayIso} · ${createdBy} ${capture ? "recorded state for" : resultWord(result)} "${subject}"${note ? ` · ${note}` : ""}.`,
      note,
      created_by: createdBy,
      source: "atlas_task_card",
      metadata: { task_id: taskId, task_title: task.title, task_result: result, object_id: targetObjectId, capture, generated_supply_task_id: supplyTaskId, generated_follow_up_task_id: followUpTaskId },
    }).select("id").single();
    if (logError) throw logError;

    const oldTaskMetadata = obj(task.metadata);
    const oldCaptureMap = obj(oldTaskMetadata.capture_by_object);
    const nextTaskMetadata = targetObjectId ? { ...oldTaskMetadata, capture_by_object: { ...oldCaptureMap, [targetObjectId]: { result, capture_kind: capture?.kind || "task_capture", completed_at: nowIso, field_log_id: fieldLog.id, capture } } } : oldTaskMetadata;
    const captureMap = obj(nextTaskMetadata.capture_by_object);
    const completeAllObjects = result === "done" && targetObjectId && taskObjectIds.length > 0 && taskObjectIds.every((id) => Boolean(obj(captureMap[id]).completed_at));
    const shouldBlock = result === "blocked" || (result === "needs_supplies" && taskObjectIds.length <= 1);
    const shouldComplete = capture ? completeAllObjects : result === "done";

    const { error: taskUpdateError } = await atlasSupabase.schema("atlas").from("tasks").update({ metadata: nextTaskMetadata, updated_at: nowIso }).eq("id", taskId);
    if (taskUpdateError) throw taskUpdateError;

    const transition: AtlasTaskTransition = shouldComplete
      ? "done"
      : shouldBlock || result === "needs_supplies"
        ? "blocked"
        : result === "changed"
          ? "changed_plan"
          : "partial";
    const transitionResult = await recordTaskTransition({
      taskId,
      transition,
      idempotencyKey: `task-result:${taskId}:${fieldLog.id}`,
      note,
      reason: shouldBlock || result === "needs_supplies" ? note || "Blocked" : null,
      laneKey: capture?.kind || "task_result",
      workKey: capture?.kind || task.task_type,
      payload: {
        adapter: "task-result",
        createdBy,
        result,
        capture,
        targetObjectId,
        generatedSupplyTaskId: supplyTaskId,
        generatedFollowUpTaskId: followUpTaskId,
      },
      existingFieldLogId: fieldLog.id,
    });

    return NextResponse.json({ ok: true, taskId, result, fieldLogId: fieldLog.id, generatedSupplyTaskId: supplyTaskId, generatedFollowUpTaskId: followUpTaskId, transition: transitionResult });
  } catch (error) {
    console.error("Atlas task result failed:", error);
    return NextResponse.json({ ok: false, error: "Atlas task result failed.", details: error instanceof Error ? error.message : "Unknown task-result error." }, { status: 500 });
  }
}
