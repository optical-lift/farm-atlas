import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { effectiveOperatorMembershipId, readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const KINDS = new Set(["spoilage", "donation", "write_off"]);
type RpcError = { code?: string; message?: string };

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function privateJson(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "flower-ready-disposition-v1" } }); }
function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This disposition is outside the active farm context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "Ready inventory was not found." }, 404);
  if (["22023", "22P02", "23505", "23514"].includes(error.code || "")) return privateJson({ ok: false, error: error.message || "The inventory disposition was rejected." }, 400);
  console.error("Ready inventory disposition failed.", error);
  return privateJson({ ok: false, error: "Ready inventory disposition could not be recorded." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) return privateJson({ ok: false, error: "Ready disposition requires a same-origin Atlas request." }, 403);

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return privateJson({ ok: false, error: "A JSON Ready disposition is required." }, 400); }

  const farmId = clean(body.farmId);
  const readyLotId = clean(body.readyLotId);
  const dispositionKind = clean(body.dispositionKind);
  const quantity = Number(body.quantity);
  const idempotencyKey = clean(body.idempotencyKey);
  if (!UUID_PATTERN.test(farmId) || !UUID_PATTERN.test(readyLotId)) return privateJson({ ok: false, error: "A valid farm and Ready lot are required." }, 400);
  if (!KINDS.has(dispositionKind)) return privateJson({ ok: false, error: "Choose spoilage, donation, or write-off." }, 400);
  if (!Number.isFinite(quantity) || quantity <= 0) return privateJson({ ok: false, error: "Disposition quantity must be positive." }, 400);
  if (!idempotencyKey) return privateJson({ ok: false, error: "An idempotency key is required." }, 400);

  const authorized = await requireAtlasApiAccess({ farmId });
  if (!authorized.ok) return authorized.response;

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) return privateJson({ ok: false, error: "The selected account has no Ready-inventory scope." }, 403);

  const args = {
    p_ready_lot_id: readyLotId,
    p_disposition_kind: dispositionKind,
    p_quantity: quantity,
    p_note: clean(body.note) || null,
    p_idempotency_key: idempotencyKey,
  };
  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_flower_ready_disposition_v1", { p_effective_membership_id: operatorMembershipId, ...args })
    : await supabase.rpc("record_flower_ready_disposition_for_member_v1", { p_farm_id: farmId, ...args });
  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) return privateJson({ ok: false, error: "Atlas returned an invalid disposition result." }, 500);
  return privateJson({ ...(response.data as Record<string, unknown>), ok: true });
}
