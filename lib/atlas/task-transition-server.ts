import { atlasSupabase } from "@/lib/atlas/supabase-server";
import {
  runTriggeredSequencesForDoneTask,
  type AtlasTriggeredSequenceResult,
  type AtlasTriggerTaskRow,
} from "@/lib/atlas/triggered-sequences-server";

export const atlasTaskTransitions = [
  "done",
  "partial",
  "blocked",
  "not_relevant",
  "changed_plan",
  "rescheduled",
  "unfinished",
  "checklist_done",
  "checklist_open",
  "note",
] as const;

export type AtlasTaskTransition = (typeof atlasTaskTransitions)[number];

export type RecordTaskTransitionInput = {
  taskId: string;
  transition: AtlasTaskTransition;
  idempotencyKey: string;
  targetDate?: string | null;
  note?: string | null;
  reason?: string | null;
  laneKey?: string | null;
  workKey?: string | null;
  payload?: Record<string, unknown>;
  existingFieldLogId?: string | null;
};

export type RecordTaskTransitionResult = {
  transitionId: string;
  taskId: string;
  status: string;
  fieldLogId: string | null;
  taskOutcomeEventId: string | null;
  childTaskIds: string[];
  childrenClosed: number;
  nextTaskId: string | null;
  deduplicated: boolean;
  triggeredSequenceResult: AtlasTriggeredSequenceResult | null;
  warnings: string[];
};

type TaskContext = AtlasTriggerTaskRow & { action_key?: string | null; work_class?: string | null };

export async function resolveAtlasTaskId(taskId?: string | null, taskTitle?: string | null) {
  if (taskId) return taskId;
  const title = taskTitle?.trim();
  if (!title) throw new Error("Task id is required.");
  const pattern = title.includes("%") ? title : `%${title}%`;
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id")
    .ilike("title", pattern)
    .in("status", ["open", "blocked"])
    .order("due_date", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data?.[0]?.id) throw new Error("No matching open task was found.");
  return data[0].id as string;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function taskContext(taskId: string) {
  const [{ data: task, error: taskError }, { data: links, error: linksError }] = await Promise.all([
    atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, farm_id, zone_id, title, task_type, status, priority, due_date, blocker_text, note, generated_from, generated_from_id, metadata, action_key, work_class")
      .eq("id", taskId)
      .single(),
    atlasSupabase.schema("atlas").from("task_objects").select("object_id").eq("task_id", taskId),
  ]);

  if (taskError || !task) throw new Error(taskError?.message || "Task was not found.");
  if (linksError) throw new Error(linksError.message);

  return {
    task: task as TaskContext,
    objectIds: (links ?? []).map((row) => row.object_id as string).filter(Boolean),
  };
}

export async function recordTaskTransition(input: RecordTaskTransitionInput): Promise<RecordTaskTransitionResult> {
  const context = input.transition === "done" ? await taskContext(input.taskId) : null;
  const { data, error } = await atlasSupabase.schema("atlas").rpc("record_task_transition_v1", {
    p_task_id: input.taskId,
    p_transition: input.transition,
    p_idempotency_key: input.idempotencyKey,
    p_target_date: input.targetDate ?? null,
    p_note: input.note ?? null,
    p_reason: input.reason ?? null,
    p_lane_key: input.laneKey ?? null,
    p_work_key: input.workKey ?? null,
    p_payload: input.payload ?? {},
    p_existing_field_log_id: input.existingFieldLogId ?? null,
  });

  if (error) throw new Error(error.message);
  const result = objectRecord(data);
  const deduplicated = result.deduplicated === true;
  const warnings: string[] = [];
  let triggeredSequenceResult: AtlasTriggeredSequenceResult | null = null;

  if (input.transition === "done" && context && !deduplicated) {
    try {
      triggeredSequenceResult = await runTriggeredSequencesForDoneTask(
        context.task,
        context.objectIds,
        new Date().toISOString(),
        input.note ?? null,
      );
    } catch (sequenceError) {
      warnings.push(sequenceError instanceof Error ? sequenceError.message : "Follow-up sequence generation needs a retry.");
    }
  }

  return {
    transitionId: stringValue(result.transitionId) ?? "",
    taskId: stringValue(result.taskId) ?? input.taskId,
    status: stringValue(result.status) ?? "open",
    fieldLogId: stringValue(result.fieldLogId),
    taskOutcomeEventId: stringValue(result.taskOutcomeEventId),
    childTaskIds: stringArray(result.childTaskIds),
    childrenClosed: typeof result.childrenClosed === "number" ? result.childrenClosed : stringArray(result.childTaskIds).length,
    nextTaskId: stringValue(result.nextTaskId),
    deduplicated,
    triggeredSequenceResult,
    warnings,
  };
}
