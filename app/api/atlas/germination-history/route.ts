import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

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

type HistorySource = {
  task?: TaskRow | null;
  sourceTask?: TaskRow | null;
};

type HistoryItem = {
  key: string;
  date: string | null;
  action: string;
  sourceTask: string | null;
  details: string[];
};

type RpcError = { code?: string };

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

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "germination-history-membership-v1",
    },
  });
}

export async function GET(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = clean(request.nextUrl.searchParams.get("taskId"));
  if (!taskId) return privateJson({ ok: false, error: "taskId is required." }, 400);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("germination_history_source_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_task_id: taskId,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "This germination task is outside the active membership scope." }, 403);
    }
    if (rpcError.code === "P0002") {
      return privateJson({ ok: false, error: "Task was not found." }, 404);
    }
    console.error("Atlas germination history read failed:", error);
    return privateJson({ ok: false, error: "Germination history lookup failed." }, 500);
  }

  const source = (data ?? {}) as HistorySource;
  const task = source.task;
  if (!task) return privateJson({ ok: false, error: "Task was not found." }, 404);

  const metadata = task.metadata ?? {};
  const objectLabel = clean(request.nextUrl.searchParams.get("objectLabel")) || null;
  const history: HistoryItem[] = [];

  if (source.sourceTask) history.push(sowingHistory(source.sourceTask, objectLabel));

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
  return privateJson({ ok: true, taskId: task.id, history });
}
