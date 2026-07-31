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
  "count_confirmed",
  "count_corrected",
  "restocked",
  "depleted",
  "unable_to_verify",
  "problem_found",
  "retired",
]);
const PROBLEM_KINDS = new Set(["damaged", "mislabeled", "missing", "contaminated", "storage_problem", "other"]);

type Body = {
  action?: unknown;
  seedLotId?: unknown;
  taskId?: unknown;
  cadenceDays?: unknown;
  warningDays?: unknown;
  graceDays?: unknown;
  firstCheckDate?: unknown;
  lowStockThreshold?: unknown;
  reason?: unknown;
  outcome?: unknown;
  observedQuantity?: unknown;
  quantityAdded?: unknown;
  source?: unknown;
  problemKind?: unknown;
  nextCheckDate?: unknown;
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

function quantity(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
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
      "X-Atlas-Write-Path": "seed-inventory-freshness-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "Seed inventory is outside the active player context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "Seed lot or recount task was not found." }, 404);
  if (["22023", "22P02", "23514"].includes(error.code || "")) {
    return privateJson({ ok: false, error: error.message || "The seed inventory change was rejected." }, 400);
  }
  console.error("Seed inventory failed.", error);
  return privateJson({ ok: false, error: "Seed inventory failed." }, 500);
}

export async function GET() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const operatorContext = await readAtlasOwnerOperatorContext();
  const farmId = operatorContext?.isOperating && operatorContext.effective.farmId
    ? operatorContext.effective.farmId
    : authorized.access.membership.farmId;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("seed_inventory_dashboard_v1", { p_farm_id: farmId });
  if (error) return rpcFailure(error as RpcError);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid seed inventory dashboard." }, 500);
  }
  return privateJson({ ...(data as Record<string, unknown>), ok: true });
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Seed inventory changes require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON seed inventory request is required." }, 400);
  }

  const action = clean(body.action);
  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm seed-inventory scope." }, 403);
  }
  const supabase = await createAtlasServerClient();

  if (action === "configure") {
    const seedLotId = clean(body.seedLotId);
    const cadenceDays = integer(body.cadenceDays);
    const warningDays = integer(body.warningDays);
    const graceDays = integer(body.graceDays);
    const firstCheckDate = isoDate(body.firstCheckDate);
    const lowStockThreshold = quantity(body.lowStockThreshold);
    const reason = clean(body.reason);

    if (!UUID_PATTERN.test(seedLotId)) return privateJson({ ok: false, error: "A valid seed lot is required." }, 400);
    if (!cadenceDays || cadenceDays < 1 || cadenceDays > 365) return privateJson({ ok: false, error: "Freshness cadence must be 1 to 365 days." }, 400);
    if (warningDays === null || warningDays < 0 || warningDays >= cadenceDays) return privateJson({ ok: false, error: "Warning days must be shorter than the cadence." }, 400);
    if (graceDays === null || graceDays < 0 || graceDays > 90) return privateJson({ ok: false, error: "Grace days must be 0 to 90." }, 400);
    if (!firstCheckDate) return privateJson({ ok: false, error: "Choose the first physical count date." }, 400);
    if (lowStockThreshold !== null && lowStockThreshold < 0) return privateJson({ ok: false, error: "Low-stock threshold cannot be negative." }, 400);
    if (!reason || reason.length > 2000) return privateJson({ ok: false, error: "Record why this count needs a freshness lifespan." }, 400);

    const response = operatorMembershipId
      ? await supabase.rpc("owner_operator_configure_seed_inventory_freshness_v1", {
          p_effective_membership_id: operatorMembershipId,
          p_seed_lot_id: seedLotId,
          p_cadence_days: cadenceDays,
          p_warning_days: warningDays,
          p_grace_days: graceDays,
          p_first_check_date: firstCheckDate,
          p_low_stock_threshold: lowStockThreshold,
          p_reason: reason,
        })
      : await supabase.rpc("configure_seed_inventory_freshness_for_member_v1", {
          p_seed_lot_id: seedLotId,
          p_cadence_days: cadenceDays,
          p_warning_days: warningDays,
          p_grace_days: graceDays,
          p_first_check_date: firstCheckDate,
          p_low_stock_threshold: lowStockThreshold,
          p_reason: reason,
        });
    if (response.error) return rpcFailure(response.error as RpcError);
    return privateJson({ ok: true, result: response.data, operatorMode: operatorContext?.isOperating ?? false });
  }

  if (action === "result") {
    const taskId = clean(body.taskId);
    const outcome = clean(body.outcome);
    const observedQuantity = outcome === "depleted" ? 0 : quantity(body.observedQuantity);
    const quantityAdded = quantity(body.quantityAdded);
    const source = clean(body.source) || null;
    const problemKind = clean(body.problemKind) || null;
    const nextCheckDate = isoDate(body.nextCheckDate);
    const note = clean(body.note) || null;
    const idempotencyKey = clean(body.idempotencyKey);

    if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid recount task is required." }, 400);
    if (!OUTCOMES.has(outcome)) return privateJson({ ok: false, error: "Choose a valid seed inventory result." }, 400);
    if (["count_confirmed", "count_corrected", "restocked"].includes(outcome) && (observedQuantity === null || observedQuantity <= 0)) {
      return privateJson({ ok: false, error: "Record the positive physical quantity on hand." }, 400);
    }
    if (outcome === "restocked" && (!quantityAdded || quantityAdded <= 0 || !source)) {
      return privateJson({ ok: false, error: "Restock requires quantity added and source." }, 400);
    }
    if (outcome === "unable_to_verify" && (!nextCheckDate || !note)) {
      return privateJson({ ok: false, error: "Unable to verify requires a future count date and note." }, 400);
    }
    if (outcome === "problem_found" && (!problemKind || !PROBLEM_KINDS.has(problemKind) || !note)) {
      return privateJson({ ok: false, error: "Choose and describe the inventory problem." }, 400);
    }
    if (outcome === "retired" && !note) return privateJson({ ok: false, error: "Record why this seed lot is being retired." }, 400);
    if (!idempotencyKey || idempotencyKey.length > 160) return privateJson({ ok: false, error: "A valid idempotency key is required." }, 400);
    if (note && note.length > 4000) return privateJson({ ok: false, error: "Note must be 4000 characters or fewer." }, 400);

    const response = operatorMembershipId
      ? await supabase.rpc("owner_operator_record_seed_inventory_result_v1", {
          p_effective_membership_id: operatorMembershipId,
          p_task_id: taskId,
          p_outcome: outcome,
          p_observed_quantity: observedQuantity,
          p_quantity_added: quantityAdded,
          p_source: source,
          p_problem_kind: problemKind,
          p_next_check_date: nextCheckDate,
          p_note: note,
          p_idempotency_key: idempotencyKey,
        })
      : await supabase.rpc("record_seed_inventory_result_for_member_v1", {
          p_farm_id: authorized.access.membership.farmId,
          p_task_id: taskId,
          p_outcome: outcome,
          p_observed_quantity: observedQuantity,
          p_quantity_added: quantityAdded,
          p_source: source,
          p_problem_kind: problemKind,
          p_next_check_date: nextCheckDate,
          p_note: note,
          p_idempotency_key: idempotencyKey,
        });
    if (response.error) return rpcFailure(response.error as RpcError);
    return privateJson({ ok: true, ...(response.data as Record<string, unknown>), operatorMode: operatorContext?.isOperating ?? false });
  }

  return privateJson({ ok: false, error: "Choose configure or result." }, 400);
}
