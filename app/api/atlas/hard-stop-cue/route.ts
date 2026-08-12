import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type HardStopTask = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  task_type: string | null;
  action_key: string | null;
  commitment_kind: string | null;
  metadata: Record<string, unknown> | null;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hardDate(task: HardStopTask) {
  const metadata = task.metadata ?? {};
  return task.commitment_kind === "hard_date"
    || text(metadata.date_behavior) === "hard_date"
    || text(metadata.date_commitment) === "hard_date"
    || text(metadata.calendar_commitment_kind) === "owner_hard_date";
}

function sowing(task: HardStopTask) {
  const joined = `${task.action_key ?? ""} ${task.task_type ?? ""}`.toLowerCase();
  return /(^|\s)(sow|seed|sowing|seeding|succession_sowing)(\s|$)/.test(joined);
}

function priority(task: HardStopTask, dateIso: string) {
  const today = task.due_date === dateIso;
  if (today && sowing(task)) return 0;
  if (today) return 1;
  if (sowing(task)) return 2;
  return 3;
}

export async function GET(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const dateIso = request.nextUrl.searchParams.get("date");
  if (!validDateIso(dateIso)) return privateJson({ ok: false, error: "date must be YYYY-MM-DD." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  const effectiveRole = operatorMembershipId
    ? operatorContext?.effective.farmRole ?? operatorContext?.effective.role
    : authorized.access.membership.role;
  const farmId = operatorMembershipId
    ? operatorContext?.effective.farmId ?? authorized.access.membership.farmId
    : authorized.access.membership.farmId;

  if (!farmId) return privateJson({ ok: true, cue: null });

  const supabase = await createAtlasServerClient();
  let targetMembershipId = operatorMembershipId;

  if (!targetMembershipId && effectiveRole === "farm_hand") {
    targetMembershipId = authorized.access.membership.id;
  }

  if (!targetMembershipId && (effectiveRole === "owner" || effectiveRole === "manager")) {
    const { data: workers, error: workerError } = await supabase
      .from("farm_memberships")
      .select("id")
      .eq("farm_id", farmId)
      .eq("role", "farm_hand")
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (workerError) return privateJson({ ok: false, error: "Atlas could not resolve the worker Day target." }, 500);
    if ((workers ?? []).length === 1) targetMembershipId = workers?.[0]?.id ?? null;
  }

  if (!targetMembershipId) return privateJson({ ok: true, cue: null });

  const { data, error } = await supabase
    .from("tasks")
    .select("id,title,status,due_date,task_type,action_key,commitment_kind,metadata")
    .eq("farm_id", farmId)
    .eq("assigned_membership_id", targetMembershipId)
    .in("status", ["open", "blocked"])
    .not("due_date", "is", null)
    .lte("due_date", dateIso as string);

  if (error) return privateJson({ ok: false, error: "Atlas could not read hard-stop work." }, 500);

  const candidates = ((data ?? []) as HardStopTask[])
    .filter(hardDate)
    .sort((left, right) => {
      const rank = priority(left, dateIso as string) - priority(right, dateIso as string);
      if (rank) return rank;
      return `${left.due_date ?? ""}:${left.title}`.localeCompare(`${right.due_date ?? ""}:${right.title}`);
    });

  const task = candidates[0];
  if (!task) return privateJson({ ok: true, cue: null });

  const isSowing = sowing(task);
  const missed = Boolean(task.due_date && task.due_date < (dateIso as string));
  const metadata = task.metadata ?? {};
  const latestSafe = text(metadata.latest_safe_sow_date);
  const biologicalCutoffToday = Boolean(isSowing && latestSafe && latestSafe === task.due_date);
  const displaySubject = text(metadata.display_subject) || task.title;
  const headline = missed
    ? effectiveRole === "owner" || effectiveRole === "manager"
      ? "OWNER DECISION NEEDED"
      : "DATE MISSED"
    : isSowing
      ? "SOW TODAY"
      : "DO TODAY";
  const body = missed
    ? "This committed date passed without a result. Atlas is holding the exception instead of silently treating today as the new due date."
    : biologicalCutoffToday
      ? "This planting window closes today."
      : isSowing
        ? "This sowing owns today. Open it before moving on."
        : "This fixed farm commitment belongs to today.";

  return privateJson({
    ok: true,
    role: effectiveRole,
    cue: {
      taskId: task.id,
      title: task.title,
      displaySubject,
      dueDate: task.due_date,
      state: missed ? "missed" : "active",
      kind: isSowing ? "sowing" : "hard_date",
      headline,
      body,
      biologicalCutoffToday,
      deepLink: `/task-focus/${encodeURIComponent(task.id)}?returnTo=${encodeURIComponent(`/day?date=${dateIso}`)}`,
    },
  });
}
