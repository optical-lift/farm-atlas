import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { effectiveOperatorMembershipId, readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RpcError = { code?: string; message?: string };

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "harvest-workbench-v1" } });
}
function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This flower work is outside the active farm context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "The selected harvest record was not found." }, 404);
  if (["22023", "22P02", "23505", "23514", "P0001"].includes(error.code || "")) return privateJson({ ok: false, error: error.message || "The flower result was rejected." }, 400);
  console.error("Harvest workbench write failed.", error);
  return privateJson({ ok: false, error: "The flower result could not be recorded." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) return privateJson({ ok: false, error: "Harvest logging requires a same-origin Atlas request." }, 403);
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return privateJson({ ok: false, error: "A JSON Harvest result is required." }, 400); }

  const action = clean(body.action);
  const farmId = clean(body.farmId) || authorized.access.membership.farmId;
  const idempotencyKey = clean(body.idempotencyKey);
  const note = clean(body.note) || null;
  if (!UUID_PATTERN.test(farmId)) return privateJson({ ok: false, error: "A valid farm is required." }, 400);
  if (!idempotencyKey || idempotencyKey.length > 96) return privateJson({ ok: false, error: "A valid workbench idempotency key is required." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) return privateJson({ ok: false, error: "The selected account has no Harvest write scope." }, 403);
  const supabase = await createAtlasServerClient();

  if (action === "harvest") {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length || rows.length > 24) return privateJson({ ok: false, error: "Choose at least one harvested crop." }, 400);
    const normalizedRows = rows.map((raw) => {
      const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const cropCycleId = clean(row.cropCycleId);
      const bucketHalves = Number(row.bucketHalves);
      const moreAvailability = clean(row.moreAvailability) || "unsure";
      const rowNote = clean(row.note) || null;
      return { cropCycleId, bucketHalves, moreAvailability, note: rowNote };
    });
    if (normalizedRows.some((row) => !UUID_PATTERN.test(row.cropCycleId) || !Number.isInteger(row.bucketHalves) || row.bucketHalves < 1 || row.bucketHalves > 40 || !["yes", "no", "unsure"].includes(row.moreAvailability))) {
      return privateJson({ ok: false, error: "Each Harvest row needs a crop, half-bucket amount, and whether more remains." }, 400);
    }
    const result = operatorMembershipId
      ? await supabase.rpc("owner_operator_record_flower_harvest_workbench_v1", { p_effective_membership_id: operatorMembershipId, p_farm_id: farmId, p_rows: normalizedRows, p_note: note, p_idempotency_key: idempotencyKey })
      : await supabase.rpc("record_flower_harvest_workbench_for_member_v1", { p_farm_id: farmId, p_rows: normalizedRows, p_note: note, p_idempotency_key: idempotencyKey });
    if (result.error) return rpcFailure(result.error as RpcError);
    return privateJson({ ...(result.data as Record<string, unknown>), ok: true, operatorMode: operatorContext?.isOperating ?? false, effectiveMembershipId: operatorMembershipId });
  }

  if (action === "prepare") {
    const harvestBatchId = clean(body.harvestBatchId);
    const outputs = Array.isArray(body.outputs) ? body.outputs : [];
    if (!UUID_PATTERN.test(harvestBatchId)) return privateJson({ ok: false, error: "Choose the harvest batch these flowers came from." }, 400);
    if (!outputs.length || outputs.length > 24) return privateJson({ ok: false, error: "Add at least one finished flower line." }, 400);
    const normalizedOutputs = outputs.map((raw) => {
      const output = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      return {
        kind: clean(output.kind || output.outputKind),
        productLabel: clean(output.productLabel),
        quantity: Number(output.quantity),
        stemsPerUnit: output.stemsPerUnit === null || output.stemsPerUnit === undefined || output.stemsPerUnit === "" ? null : Number(output.stemsPerUnit),
        cropProfileId: clean(output.cropProfileId) || null,
      };
    });
    if (normalizedOutputs.some((output) => !output.kind || !output.productLabel || !Number.isFinite(output.quantity) || output.quantity <= 0 || ((output.kind === "bundle" || output.kind === "bunch") && (!Number.isInteger(output.stemsPerUnit) || Number(output.stemsPerUnit) < 1)))) {
      return privateJson({ ok: false, error: "Each finished line needs its flower, pack type, quantity, and stems per bunch when applicable." }, 400);
    }
    const result = operatorMembershipId
      ? await supabase.rpc("owner_operator_record_flower_preparation_workbench_v1", { p_effective_membership_id: operatorMembershipId, p_farm_id: farmId, p_harvest_batch_id: harvestBatchId, p_outputs: normalizedOutputs, p_note: note, p_idempotency_key: idempotencyKey })
      : await supabase.rpc("record_flower_preparation_workbench_for_member_v1", { p_farm_id: farmId, p_harvest_batch_id: harvestBatchId, p_outputs: normalizedOutputs, p_note: note, p_idempotency_key: idempotencyKey });
    if (result.error) return rpcFailure(result.error as RpcError);
    return privateJson({ ...(result.data as Record<string, unknown>), ok: true, operatorMode: operatorContext?.isOperating ?? false, effectiveMembershipId: operatorMembershipId });
  }

  return privateJson({ ok: false, error: "Choose Harvest Stems or Condition + Bunch." }, 400);
}
