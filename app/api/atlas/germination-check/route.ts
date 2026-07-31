import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "not_yet",
  "beginning",
  "germinated",
  "failed_or_uncertain",
  "problem_found",
]);
const SPACING_OUTCOMES = new Set(["thin", "on_target", "patch"]);

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

type GerminationBody = {
  taskId?: unknown;
  taskTitle?: unknown;
  action?: unknown;
  spacingOutcome?: unknown;
  targetSpacingInches?: unknown;
  note?: unknown;
};

type RpcError = { code?: string; message?: string };

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
      "X-Atlas-Read-Path": "germination-observation-clock-v2",
    },
  });
}

function rpcFailure(error: RpcError, fallback: string) {
  if (error.code === "42501") {
    return privateJson({ ok: false, error: "This germination task is outside the active worker context." }, 403);
  }
  if (error.code === "P0002") {
    return privateJson({ ok: false, error: "Germination check task was not found." }, 404);
  }
  if (error.code === "22023" || error.code === "22P02") {
    return privateJson({ ok: false, error: error.message || "The germination result was rejected." }, 400);
  }
  console.error(fallback, error);
  return privateJson({ ok: false, error: fallback }, 500);
}

export async function GET(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = clean(request.nextUrl.searchParams.get("taskId")) || null;
  const taskTitle = clean(request.nextUrl.searchParams.get("taskTitle")) || null;
  if (!taskId && !taskTitle) return privateJson({ ok: false, error: "Task id or title is required." }, 400);
  if (taskId && !UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid task id is required." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm germination scope." }, 403);
  }

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_germination_check_source_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
        p_task_title: taskTitle,
      })
    : await supabase.rpc("germination_check_source_v1", {
        p_farm_id: authorized.access.membership.farmId,
        p_task_id: taskId,
        p_task_title: taskTitle,
      });
  const { data, error } = response;

  if (error) return rpcFailure(error as RpcError, "Germination check lookup failed.");

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
    operatorMode: operatorContext?.isOperating ?? false,
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

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Germination results require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: GerminationBody;
  try {
    body = await request.json() as GerminationBody;
  } catch {
    return privateJson({ ok: false, error: "A JSON germination result is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const taskTitle = clean(body.taskTitle) || null;
  const action = clean(body.action);
  const spacingOutcome = clean(body.spacingOutcome) || null;
  const targetSpacingInches = positiveNumber(body.targetSpacingInches);
  const note = clean(body.note) || null;

  if (!UUID_PATTERN.test(taskId)) {
    return privateJson({ ok: false, error: "A valid task id is required." }, 400);
  }
  if (!ACTIONS.has(action)) {
    return privateJson({ ok: false, error: "Choose not yet, beginning, germinated, failed or uncertain, or problem found." }, 400);
  }
  if (action === "germinated" && (!spacingOutcome || !SPACING_OUTCOMES.has(spacingOutcome))) {
    return privateJson({ ok: false, error: "Choose thin, on target, or patch." }, 400);
  }

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm germination scope." }, 403);
  }

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_germination_observation_v2", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
        p_action: action,
        p_spacing_outcome: action === "germinated" ? spacingOutcome : null,
        p_target_spacing_inches: action === "germinated" ? targetSpacingInches : null,
        p_note: note,
      })
    : await supabase.rpc("record_germination_observation_for_member_v2", {
        p_farm_id: authorized.access.membership.farmId,
        p_task_id: taskId,
        p_task_title: taskTitle,
        p_action: action,
        p_spacing_outcome: action === "germinated" ? spacingOutcome : null,
        p_target_spacing_inches: action === "germinated" ? targetSpacingInches : null,
        p_note: note,
      });
  const { data, error } = response;

  if (error) return rpcFailure(error as RpcError, "Germination observation failed.");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid germination observation." }, 500);
  }

  return privateJson({
    ...(data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
    effectiveMembershipId: operatorMembershipId,
  });
}
