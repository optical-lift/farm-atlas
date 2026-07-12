import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type TaskRow = {
  id: string;
  title: string;
  task_type: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  note: string | null;
  metadata: Record<string, unknown> | null;
};

type HistoryItem = {
  key: string;
  date: string | null;
  action: string;
  sourceTask: string | null;
  details: string[];
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateOnly(value: unknown) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function taskDate(task: TaskRow) {
  const metadata = task.metadata ?? {};
  return (
    dateOnly(metadata.actual_sow_date) ||
    dateOnly(metadata.source_sown_date) ||
    dateOnly(metadata.trigger_anchor_date) ||
    dateOnly(task.completed_at) ||
    dateOnly(task.due_date) ||
    dateOnly(task.created_at)
  );
}

function uniqueDetails(values: Array<string | null>) {
  return Array.from(new Set(values.map((value) => clean(value)).filter(Boolean)));
}

async function fetchTask(taskId: string) {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id, title, task_type, status, due_date, completed_at, created_at, note, metadata")
    .eq("id", taskId)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data?.[0]) throw new Error("Task was not found.");
  return data[0] as TaskRow;
}

function sowingHistory(task: TaskRow, objectLabel: string | null): HistoryItem {
  const metadata = task.metadata ?? {};
  const count = numberValue(metadata.container_count);
  const containerKind = clean(metadata.container_kind);
  const displayDetail = clean(metadata.display_detail);
  const location = clean(metadata.collection_zone) || objectLabel;
  const amount = count && containerKind ? `${count} × ${containerKind}` : count ? `${count} containers` : containerKind || null;

  return {
    key: `task-${task.id}`,
    date: taskDate(task),
    action: clean(metadata.display_action) || (task.task_type.includes("sow") || task.title.toLowerCase().includes("sow") ? "Sowed" : "Completed"),
    sourceTask: task.title,
    details: uniqueDetails([
      displayDetail || null,
      amount,
      location,
      clean(metadata.checklist_label) || null,
      clean(metadata.crop_profile_stable_key) ? `Crop profile: ${clean(metadata.crop_profile_stable_key)}` : null,
    ]),
  };
}

export async function GET(request: NextRequest) {
  try {
    const taskId = clean(request.nextUrl.searchParams.get("taskId"));
    if (!taskId) return NextResponse.json({ ok: false, error: "taskId is required." }, { status: 400 });

    const task = await fetchTask(taskId);
    const metadata = task.metadata ?? {};
    const sourceSowingTaskId = clean(metadata.source_sowing_task_id);
    const objectLabel = clean(request.nextUrl.searchParams.get("objectLabel")) || null;
    const history: HistoryItem[] = [];

    if (sourceSowingTaskId) {
      const sourceTask = await fetchTask(sourceSowingTaskId);
      history.push(sowingHistory(sourceTask, objectLabel));
    }

    const notYetCount = numberValue(metadata.not_yet_count) ?? 0;
    if (notYetCount > 0) {
      history.push({
        key: `not-yet-${task.id}`,
        date: dateOnly(metadata.last_not_yet_at) || taskDate(task),
        action: "Checked — not yet germinated",
        sourceTask: task.title,
        details: uniqueDetails([
          `${notYetCount} check${notYetCount === 1 ? "" : "s"} recorded`,
          clean(metadata.last_not_yet_note) || null,
        ]),
      });
    }

    history.push({
      key: `current-${task.id}`,
      date: dateOnly(task.due_date),
      action: "Germination check due",
      sourceTask: task.title,
      details: uniqueDetails([
        objectLabel,
        clean(metadata.actual_sow_date) ? `Sown ${clean(metadata.actual_sow_date)}` : null,
      ]),
    });

    history.sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31"));
    return NextResponse.json({ ok: true, taskId: task.id, history });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Germination history lookup failed.", details: error instanceof Error ? error.message : "Unknown error." },
      { status: 500 },
    );
  }
}
