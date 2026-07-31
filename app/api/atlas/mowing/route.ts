import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set([
  "mowed_full",
  "mowed_partial",
  "acceptable_no_cut",
  "too_wet",
  "equipment_or_area_problem",
  "closed_not_mowable",
]);

type Body = {
  taskId?: unknown;
  outcome?: unknown;
  completionPercent?: unknown;
  recheckDate?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function percent(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 100 ? number : null;
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
      "X-Atlas-Write-Path": "mowing-clock-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This mowing route is outside the active player context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Mowing task or route was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The mowing result was rejected." }, 400);
  console.error("Mowing result failed.", error);
  return privateJson({ ok: false, error: "Mowing result failed." }, 500);
}

export async function GET() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const operatorContext = await readAtlasOwnerOperatorContext();
  const farmId = operatorContext?.isOperating && operatorContext.effective.farmId
    ? operatorContext.effective.farmId
    : authorized.access.membership.farmId;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("mowing_rhythm_dashboard_v1", { p_farm_id: farmId });
  if (error) return rpcFailure(error as RpcError);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid mowing dashboard." }, 500);
  }
  return privateJson({ ...(data as Record<string, unknown>), ok: true });
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Mowing results require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON mowing result is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const outcome = clean(body.outcome);
  const completionPercent = percent(body.completionPercent);
  const recheckDate = isoDate(body.recheckDate);
  const note = clean(body.note) || null;
  const idempotencyKey = clean(body.idempotencyKey);

  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid task id is required." }, 400);
  if (!OUTCOMES.has(outcome)) return privateJson({ ok: false, error: "Choose a valid mowing result." }, 400);
  if (outcome === "mowed_partial" && (!completionPercent || completionPercent >= 100)) {
    return privateJson({ ok: false, error: "Partial mowing requires a completion percent from 1 to 99." }, 400);
  }
  if (["acceptable_no_cut", "too_wet"].includes(outcome) && !recheckDate) {
    return privateJson({ ok: false, error: "Choose a future recheck date." }, 400);
  }
  if (["mowed_partial", "equipment_or_area_problem"].includes(outcome) && !note) {
    return privateJson({ ok: false, error: "Describe what remains or what is wrong." }, 400);
  }
  if (!idempotencyKey || idempotencyKey.length > 160) return privateJson({ ok: false, error: "A valid idempotency key is required." }, 400);
  if (note && note.length > 3000) return privateJson({ ok: false, error: "Note must be 3000 characters or fewer." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm mowing scope." }, 403);
  }

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_mowing_result_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
        p_outcome: outcome,
        p_completion_percent: completionPercent,
        p_recheck_date: recheckDate,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      })
    : await supabase.rpc("record_mowing_result_for_member_v1", {
        p_farm_id: authorized.access.membership.farmId,
        p_task_id: taskId,
        p_outcome: outcome,
        p_completion_percent: completionPercent,
        p_recheck_date: recheckDate,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid mowing result." }, 500);
  }

  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
    effectiveMembershipId: operatorMembershipId,
  });
}
