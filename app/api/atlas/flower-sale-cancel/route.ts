import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { effectiveOperatorMembershipId, readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const REASONS = new Set(["customer_cancelled", "seller_cancelled", "entry_correction", "other"]);
type RpcError = { code?: string; message?: string };

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function privateJson(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "flower-commercial-cancellation-v1" } }); }
function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This cancellation is outside the active farm context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "Flower sale was not found." }, 404);
  if (["22023", "22P02", "23505", "23514"].includes(error.code || "")) return privateJson({ ok: false, error: error.message || "The cancellation was rejected." }, 400);
  console.error("Flower sale cancellation failed.", error);
  return privateJson({ ok: false, error: "Flower sale could not be cancelled." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) return privateJson({ ok: false, error: "Flower sale cancellation requires a same-origin Atlas request." }, 403);

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return privateJson({ ok: false, error: "A JSON cancellation is required." }, 400); }

  const farmId = clean(body.farmId);
  const saleOrderId = clean(body.saleOrderId);
  const reasonKind = clean(body.reasonKind);
  const idempotencyKey = clean(body.idempotencyKey);
  if (!UUID_PATTERN.test(farmId) || !UUID_PATTERN.test(saleOrderId)) return privateJson({ ok: false, error: "A valid farm and flower sale are required." }, 400);
  if (!REASONS.has(reasonKind)) return privateJson({ ok: false, error: "Choose a valid cancellation reason." }, 400);
  if (!idempotencyKey) return privateJson({ ok: false, error: "An idempotency key is required." }, 400);

  const authorized = await requireAtlasApiAccess({ farmId });
  if (!authorized.ok) return authorized.response;

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) return privateJson({ ok: false, error: "The selected account has no flower-sales scope." }, 403);

  const args = {
    p_sale_order_id: saleOrderId,
    p_reason_kind: reasonKind,
    p_note: clean(body.note) || null,
    p_idempotency_key: idempotencyKey,
  };
  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_cancel_flower_sale_v1", { p_effective_membership_id: operatorMembershipId, ...args })
    : await supabase.rpc("cancel_flower_sale_for_member_v1", { p_farm_id: farmId, ...args });
  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) return privateJson({ ok: false, error: "Atlas returned an invalid cancellation result." }, 500);
  return privateJson({ ...(response.data as Record<string, unknown>), ok: true });
}
