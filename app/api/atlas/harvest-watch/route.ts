import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const ACTIONS = new Set(["not_ready", "beginning", "harvestable", "declining", "finished", "problem_or_uncertain"]);

type Body = {
  taskId?: unknown;
  action?: unknown;
  estimatedQuantity?: unknown;
  unit?: unknown;
  recheckDate?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nonnegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) return null;
  return Math.round(number * 100) / 100;
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
      "X-Atlas-Write-Path": "harvest-watch-clock-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: "This harvest watch is outside the active worker context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Harvest watch task was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The harvest observation was rejected." }, 400);
  console.error("Harvest Watch observation failed.", error);
  return privateJson({ ok: false, error: "Harvest Watch observation failed." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Harvest observations require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON harvest observation is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const action = clean(body.action);
  const estimatedQuantity = nonnegativeNumber(body.estimatedQuantity);
  const unit = clean(body.unit) || null;
  const recheckDate = isoDate(body.recheckDate);
  const note = clean(body.note) || null;
  const idempotencyKey = clean(body.idempotencyKey);

  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid task id is required." }, 400);
  if (!ACTIONS.has(action)) return privateJson({ ok: false, error: "Choose not ready, beginning, harvestable, declining, finished, or problem or uncertain." }, 400);
  if (!idempotencyKey) return privateJson({ ok: false, error: "An idempotency key is required." }, 400);
  if (body.estimatedQuantity !== null && body.estimatedQuantity !== undefined && body.estimatedQuantity !== "" && estimatedQuantity === null) {
    return privateJson({ ok: false, error: "Estimated quantity must be zero or greater." }, 400);
  }

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm harvest scope." }, 403);
  }

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_harvest_watch_observation_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
        p_action: action,
        p_estimated_quantity: estimatedQuantity,
        p_unit: unit,
        p_recheck_date: recheckDate,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      })
    : await supabase.rpc("record_harvest_watch_observation_for_member_v1", {
        p_farm_id: authorized.access.membership.farmId,
        p_task_id: taskId,
        p_action: action,
        p_estimated_quantity: estimatedQuantity,
        p_unit: unit,
        p_recheck_date: recheckDate,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid harvest observation." }, 500);
  }

  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
    effectiveMembershipId: operatorMembershipId,
  });
}
