import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SourceTask = {
  id: string;
  title: string;
  task_type: string;
  status: string;
  due_date: string | null;
  priority: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
};

type SourceProfile = {
  id: string;
  stable_key: string;
  crop_label: string;
  variety: string | null;
  days_to_germination_min: number | null;
  days_to_germination_max: number | null;
  days_to_harvest_watch_min: number | null;
  days_to_harvest_watch_max: number | null;
  metadata: Record<string, unknown> | null;
};

type GerminationSource = {
  task?: SourceTask | null;
  object?: { objectId?: string | null; objectLabel?: string | null; objectKey?: string | null } | null;
  profile?: SourceProfile | null;
};

type RpcError = { code?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) return Number(value);
  return null;
}

function positiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number <= 0 || number > 120) return null;
  return Math.round(number * 100) / 100;
}

function spacingFromProfile(metadata: Record<string, unknown> | null | undefined) {
  const direct = positiveNumber(metadata?.target_spacing_inches);
  if (direct) return direct;
  const lines = Array.isArray(metadata?.spacing_lines) ? metadata.spacing_lines : [];
  for (const line of lines) {
    if (typeof line !== "string") continue;
    const match = line.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches)\b/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "germination-check-membership-v1",
    },
  });
}

export async function GET(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = clean(request.nextUrl.searchParams.get("taskId")) || null;
  const taskTitle = clean(request.nextUrl.searchParams.get("taskTitle")) || null;
  if (!taskId && !taskTitle) return privateJson({ ok: false, error: "Task id or title is required." }, 400);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("germination_check_source_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_task_id: taskId,
    p_task_title: taskTitle,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "This germination task is outside the active membership scope." }, 403);
    }
    if (rpcError.code === "P0002") {
      return privateJson({ ok: false, error: "Germination check task was not found." }, 404);
    }
    console.error("Atlas germination check lookup failed:", error);
    return privateJson({ ok: false, error: "Germination check lookup failed." }, 500);
  }

  const source = (data ?? {}) as GerminationSource;
  const task = source.task;
  if (!task) return privateJson({ ok: false, error: "Germination check task was not found." }, 404);

  const metadata = task.metadata ?? {};
  if (clean(metadata.task_style) !== "germination_check" && task.task_type !== "germination_check") {
    return privateJson({ ok: true, germinationCheck: false });
  }

  const profile = source.profile;
  if (!profile) return privateJson({ ok: false, error: "Seed profile was not found." }, 500);

  return privateJson({
    ok: true,
    germinationCheck: true,
    task: {
      id: task.id,
      title: task.title,
      dueDate: task.due_date,
      objectLabel: source.object?.objectLabel ?? "Unassigned growing area",
      cropLabel: profile.crop_label,
      variety: profile.variety,
      targetSpacingInches: spacingFromProfile(profile.metadata),
      expectedMinDays: profile.days_to_germination_min,
      expectedMaxDays: profile.days_to_germination_max,
      notYetCount: positiveInteger(metadata.not_yet_count) ?? 0,
    },
  });
}
