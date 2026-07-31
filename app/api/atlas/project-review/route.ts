import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(["on_track", "next_move_changed", "waiting_external", "blocked", "complete"]);

type Body = {
  action?: unknown;
  projectId?: unknown;
  taskId?: unknown;
  cadenceDays?: unknown;
  warningDays?: unknown;
  graceDays?: unknown;
  firstReviewDate?: unknown;
  reason?: unknown;
  outcome?: unknown;
  nextMilestone?: unknown;
  nextReviewDate?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : null;
}

function isoDate(value: unknown) {
  const date = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "project-review-clock-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "Project review is outside the active Owner context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "Project or review task was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02" || error.code === "23514") {
    return privateJson({ ok: false, error: error.message || "The project review was rejected." }, 400);
  }
  console.error("Project review failed.", error);
  return privateJson({ ok: false, error: "Project review failed." }, 500);
}

export async function GET(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const projectId = clean(request.nextUrl.searchParams.get("projectId"));
  if (!UUID_PATTERN.test(projectId)) return privateJson({ ok: false, error: "A valid project id is required." }, 400);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("project_review_dashboard_v1", { p_project_id: projectId });
  if (error) return rpcFailure(error as RpcError);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid project review dashboard." }, 500);
  }
  return privateJson({ ...(data as Record<string, unknown>), ok: true });
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Project review changes require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON project review request is required." }, 400);
  }

  const action = clean(body.action);
  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm project-review scope." }, 403);
  }

  const supabase = await createAtlasServerClient();

  if (action === "configure") {
    const projectId = clean(body.projectId);
    const cadenceDays = integer(body.cadenceDays);
    const warningDays = integer(body.warningDays);
    const graceDays = integer(body.graceDays);
    const firstReviewDate = isoDate(body.firstReviewDate);
    const reason = clean(body.reason);

    if (!UUID_PATTERN.test(projectId)) return privateJson({ ok: false, error: "A valid project id is required." }, 400);
    if (!cadenceDays || cadenceDays < 1 || cadenceDays > 365) return privateJson({ ok: false, error: "Review cadence must be 1 to 365 days." }, 400);
    if (warningDays === null || warningDays < 0 || warningDays >= cadenceDays) return privateJson({ ok: false, error: "Warning days must be zero or more and shorter than the cadence." }, 400);
    if (graceDays === null || graceDays < 0 || graceDays > 90) return privateJson({ ok: false, error: "Grace days must be 0 to 90." }, 400);
    if (!firstReviewDate) return privateJson({ ok: false, error: "Choose the first review date." }, 400);
    if (!reason || reason.length > 2000) return privateJson({ ok: false, error: "Record why this project needs a review rhythm." }, 400);

    const response = operatorMembershipId
      ? await supabase.rpc("owner_operator_configure_project_review_v1", {
          p_effective_membership_id: operatorMembershipId,
          p_project_id: projectId,
          p_cadence_days: cadenceDays,
          p_warning_days: warningDays,
          p_grace_days: graceDays,
          p_first_review_date: firstReviewDate,
          p_reason: reason,
        })
      : await supabase.rpc("configure_project_review_for_member_v1", {
          p_project_id: projectId,
          p_cadence_days: cadenceDays,
          p_warning_days: warningDays,
          p_grace_days: graceDays,
          p_first_review_date: firstReviewDate,
          p_reason: reason,
        });

    if (response.error) return rpcFailure(response.error as RpcError);
    if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
      return privateJson({ ok: false, error: "Atlas returned an invalid project review configuration." }, 500);
    }
    return privateJson({ ...(response.data as Record<string, unknown>), ok: true, operatorMode: operatorContext?.isOperating ?? false });
  }

  if (action === "review") {
    const taskId = clean(body.taskId);
    const outcome = clean(body.outcome);
    const nextMilestone = clean(body.nextMilestone) || null;
    const nextReviewDate = isoDate(body.nextReviewDate);
    const note = clean(body.note) || null;
    const idempotencyKey = clean(body.idempotencyKey);

    if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid review task id is required." }, 400);
    if (!OUTCOMES.has(outcome)) return privateJson({ ok: false, error: "Choose a valid project review result." }, 400);
    if (outcome === "next_move_changed" && !nextMilestone) return privateJson({ ok: false, error: "Record the new current move." }, 400);
    if (["waiting_external", "blocked"].includes(outcome) && (!note || !nextReviewDate)) {
      return privateJson({ ok: false, error: "Waiting and blocked projects require a note and future review date." }, 400);
    }
    if (nextMilestone && nextMilestone.length > 500) return privateJson({ ok: false, error: "Next move must be 500 characters or fewer." }, 400);
    if (note && note.length > 4000) return privateJson({ ok: false, error: "Review note must be 4000 characters or fewer." }, 400);
    if (!idempotencyKey || idempotencyKey.length > 160) return privateJson({ ok: false, error: "A valid idempotency key is required." }, 400);

    const response = operatorMembershipId
      ? await supabase.rpc("owner_operator_record_project_review_result_v1", {
          p_effective_membership_id: operatorMembershipId,
          p_task_id: taskId,
          p_outcome: outcome,
          p_next_milestone: nextMilestone,
          p_next_review_date: nextReviewDate,
          p_note: note,
          p_idempotency_key: idempotencyKey,
        })
      : await supabase.rpc("record_project_review_result_for_member_v1", {
          p_farm_id: authorized.access.membership.farmId,
          p_task_id: taskId,
          p_outcome: outcome,
          p_next_milestone: nextMilestone,
          p_next_review_date: nextReviewDate,
          p_note: note,
          p_idempotency_key: idempotencyKey,
        });

    if (response.error) return rpcFailure(response.error as RpcError);
    if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
      return privateJson({ ok: false, error: "Atlas returned an invalid project review result." }, 500);
    }
    return privateJson({ ...(response.data as Record<string, unknown>), ok: true, operatorMode: operatorContext?.isOperating ?? false });
  }

  return privateJson({ ok: false, error: "Choose configure or review." }, 400);
}
