import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { atlasFarmDateIso } from "@/lib/atlas/farm-day";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESULTS = new Set(["depleted", "exact_remaining", "some_left_unknown"]);

type Body = {
  taskId?: unknown;
  result?: unknown;
  actualMinutes?: unknown;
  remainingQuantity?: unknown;
  note?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 1440 ? parsed : null;
}

function positiveNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Write-Path": "direct-sow-seed-result-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return json({ ok: false, error: error.message || "This sowing task is outside the active worker context." }, 403);
  if (error.code === "P0002") return json({ ok: false, error: error.message || "Sowing task was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return json({ ok: false, error: error.message || "The sowing result was rejected." }, 400);
  console.error("Direct sow result failed.", error);
  return json({ ok: false, error: "Direct sow result failed." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return json({ ok: false, error: "Sowing results require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return json({ ok: false, error: "A JSON sowing result is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const result = clean(body.result).toLowerCase();
  const actualMinutes = positiveInteger(body.actualMinutes);
  const remainingQuantity = body.remainingQuantity === null || body.remainingQuantity === undefined || body.remainingQuantity === ""
    ? null
    : positiveNumber(body.remainingQuantity);
  const note = clean(body.note) || null;

  if (!UUID_PATTERN.test(taskId)) return json({ ok: false, error: "A valid task id is required." }, 400);
  if (!RESULTS.has(result)) return json({ ok: false, error: "Choose whether the seed lot was depleted, has some left, or has an exact amount left." }, 400);
  if (!actualMinutes) return json({ ok: false, error: "Enter how many minutes the sowing took." }, 400);
  if (result === "exact_remaining" && remainingQuantity === null) return json({ ok: false, error: "Enter the exact number of seeds remaining." }, 400);
  if (result !== "exact_remaining" && remainingQuantity !== null) return json({ ok: false, error: "An exact remaining count is only used when you know the exact amount left." }, 400);

  const serviceDate = atlasFarmDateIso();
  const idempotencyKey = `direct-sow-result:${taskId}:${serviceDate}`;
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("record_direct_sow_seed_result_for_member_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_membership_id: authorized.access.membership.membershipId,
    p_task_id: taskId,
    p_service_date: serviceDate,
    p_result: result,
    p_actual_minutes: actualMinutes,
    p_idempotency_key: idempotencyKey,
    p_remaining_quantity: result === "exact_remaining" ? remainingQuantity : null,
    p_note: note,
  });

  if (error) return rpcFailure(error as RpcError);
  return json({ ok: true, result: data, serviceDate });
}
