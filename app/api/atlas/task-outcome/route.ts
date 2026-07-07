import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Outcome = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

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

type ObjectStateRow = {
  object_id: string;
  metadata: Record<string, unknown> | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isOutcome(value: unknown): value is Outcome {
  return value === "done" || value === "partial" || value === "blocked" || value === "not_relevant" || value === "changed_plan";
}

function nextStatus(outcome: Outcome) {
  if (outcome === "done") return "done";
  if (outcome === "blocked") return "blocked";
  if (outcome === "not_relevant" || outcome === "changed_plan") return "archived";
  return "open";
}

function actionTypesFor(task: TaskRow, outcome: Outcome, laneKey: string | null, workKey: string | null) {
  return Array.from(new Set([`task_${outcome}`, laneKey, workKey, task.task_type].filter(Boolean) as string[]));
}

function shouldMarkChecked(task: TaskRow, laneKey: string | null) {
  const text = `${laneKey ?? ""} ${task.task_type ?? ""} ${task.title}`.toLowerCase();
  return text.includes("verify") || text.includes("check") || text.includes("confirm") || text.includes("count") || text.includes("germin") || text.includes("mark");
}

function shouldMarkWeeded(task: TaskRow, laneKey: string | null) {
  const text = `${laneKey ?? ""} ${task.task_type ?? ""} ${task.title}`.toLowerCase();
  return text.includes("weed") || text.includes("hoe");
}

function shouldMarkWatered(task: TaskRow, laneKey: string | null) {
  const text = `${laneKey ?? ""} ${task.task_type ?? ""} ${task.title}`.toLowerCase();
  return text.includes("water");
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

async function getTaskObjectIds(taskId: string) {
  const { data, error } = await atlasSupabase.schema("atlas").from("task_objects").select("object_id").eq("task_id", taskId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.object_id as string).filter(Boolean);
}

async function updateObjectMemory(task: TaskRow, objectIds: string[], outcome: Outcome, note: string | null, laneKey: string | null, workKey: string | null, now: string) {
  if (objectIds.length === 0) return;
  const today = now.slice(0, 10);
  const { data, error } = await atlasSupabase.schema("atlas").from("object_state").select("object_id, metadata").in("object_id", objectIds);
  if (error) throw new Error(error.message);

  const existing = new Map((data ?? []).map((row) => [(row as ObjectStateRow).object_id, (row as ObjectStateRow).metadata ?? {}]));
  const rows = objectIds.map((objectId) => {
    const metadata = {
      ...(existing.get(objectId) ?? {}),
      last_task_event: {
        task_id: task.id,
        task_title: task.title,
        outcome,
        note,
        lane_key: laneKey,
        work_key: workKey,
        recorded_at: now,
      },
    };

    return {
      object_id: objectId,
      farm_id: task.farm_id,
      last_touched_at: today,
      last_checked_at: shouldMarkChecked(task, laneKey) ? today : undefined,
      last_weeded_at: shouldMarkWeeded(task, laneKey) ? today : undefined,
      last_watered_at: shouldMarkWatered(task, laneKey) ? today : undefined,
      decision_required: outcome === "blocked" || outcome === "changed_plan" ? true : outcome === "done" || outcome === "not_relevant" ? false : undefined,
      metadata,
      updated_at: now,
    };
  });

  const { error: upsertError } = await atlasSupabase.schema("atlas").from("object_state").upsert(rows, { onConflict: "object_id" });
  if (upsertError) throw new Error(upsertError.message);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const outcome = body.outcome;
    if (!isOutcome(outcome)) {
      return NextResponse.json({ ok: false, error: "Outcome must be done, partial, blocked, not relevant, or changed plan." }, { status: 400 });
    }

    const task = await getTask(body);
    const now = new Date().toISOString();
    const note = clean(body.note) || null;
    const reason = clean(body.reason) || null;
    const laneKey = clean(body.laneKey) || null;
    const workKey = clean(body.workKey) || null;
    const objectIds = await getTaskObjectIds(task.id);
    const metadata = {
      ...(task.metadata ?? {}),
      last_outcome: {
        outcome,
        reason,
        note,
        lane_key: laneKey,
        work_key: workKey,
        object_ids: objectIds,
        recorded_at: now,
      },
      outcome_history_count: typeof task.metadata?.outcome_history_count === "number" ? task.metadata.outcome_history_count + 1 : 1,
    };

    const updatePayload: Record<string, unknown> = { status: nextStatus(outcome), metadata, updated_at: now };
    if (outcome === "done") updatePayload.completed_at = now;
    if (outcome === "partial" && note) updatePayload.note = [task.note, note].filter(Boolean).join("\n");
    if (outcome === "blocked") updatePayload.blocker_text = reason || note || task.blocker_text || "blocked";
    if (outcome === "not_relevant") updatePayload.note = [task.note, reason || note || "Marked not relevant"].filter(Boolean).join("\n");
    if (outcome === "changed_plan") updatePayload.note = [task.note, reason || note || "Plan changed"].filter(Boolean).join("\n");

    const { error: updateError } = await atlasSupabase.schema("atlas").from("tasks").update(updatePayload).eq("id", task.id);
    if (updateError) throw new Error(updateError.message);

    const { data: eventData, error: eventError } = await atlasSupabase.schema("atlas").from("task_outcome_events").insert({
      farm_id: task.farm_id,
      task_id: task.id,
      outcome,
      lane_key: laneKey,
      work_key: workKey,
      blocker_reason: reason,
      note,
      task_title: task.title,
      task_type: task.task_type,
      zone_id: task.zone_id,
      due_date: task.due_date,
      priority: task.priority,
      source: "atlas_task_outcome",
      metadata: { prior_status: task.status, object_ids: objectIds },
    }).select("id").single();
    if (eventError) throw new Error(eventError.message);

    const eventId = eventData?.id as string | undefined;
    const logSummary = [task.title, outcome === "done" ? "done" : outcome.replace(/_/g, " "), note].filter(Boolean).join(" · ");
    const { error: logError } = await atlasSupabase.schema("atlas").from("field_logs").insert({
      farm_id: task.farm_id,
      log_date: now.slice(0, 10),
      action_types: actionTypesFor(task, outcome, laneKey, workKey),
      summary_sentence: logSummary,
      note,
      source: "atlas_task_board",
      metadata: {
        task_id: task.id,
        task_title: task.title,
        task_outcome_event_id: eventId,
        outcome,
        lane_key: laneKey,
        work_key: workKey,
        object_ids: objectIds,
      },
    });
    if (logError) throw new Error(logError.message);

    await updateObjectMemory(task, objectIds, outcome, note, laneKey, workKey, now);

    return NextResponse.json({ ok: true, taskId: task.id, outcome, status: nextStatus(outcome), eventId });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas task outcome failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
