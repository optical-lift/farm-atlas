import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { effectiveOperatorMembershipId, readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RpcError = { code?: string; message?: string };
type Json = Record<string, unknown>;

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function privateJson(body: Json, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "flower-prospect-route-v2" } });
}
function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This flower movement is outside the active operating context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "The flower route record was not found." }, 404);
  if (["22023", "22P02", "23505", "23514"].includes(error.code || "")) return privateJson({ ok: false, error: error.message || "The flower movement was rejected." }, 400);
  console.error("Flower prospect-route write failed.", error);
  return privateJson({ ok: false, error: "The flower movement could not be recorded." }, 500);
}
function quantity(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return privateJson({ ok: false, error: "Flower movement requires a same-origin Atlas request." }, 403);

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Json;
  try { body = await request.json() as Json; }
  catch { return privateJson({ ok: false, error: "A JSON flower movement is required." }, 400); }

  const action = clean(body.action);
  const idempotencyKey = clean(body.idempotencyKey);
  if (!idempotencyKey || idempotencyKey.length > 160) return privateJson({ ok: false, error: "A valid idempotency key is required." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) return privateJson({ ok: false, error: "The selected account has no flower-route scope." }, 403);

  const supabase = await createAtlasServerClient();

  if (action === "send") {
    const farmId = clean(body.farmId) || authorized.access.membership.farmId;
    const assignedMembershipId = clean(body.assignedMembershipId) || null;
    const custodianLabel = clean(body.custodianLabel) || null;
    const routeDate = clean(body.routeDate);
    const routeLabel = clean(body.routeLabel);
    const note = clean(body.note) || null;
    const rawLines = Array.isArray(body.lines) ? body.lines : [];

    if (!UUID.test(farmId)) return privateJson({ ok: false, error: "A valid farm is required." }, 400);
    if (assignedMembershipId && !UUID.test(assignedMembershipId)) return privateJson({ ok: false, error: "The Atlas custodian is invalid." }, 400);
    if ((assignedMembershipId ? 1 : 0) + (custodianLabel ? 1 : 0) !== 1) return privateJson({ ok: false, error: "Choose exactly one person who has the flowers." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(routeDate)) return privateJson({ ok: false, error: "A route date is required." }, 400);
    if (!routeLabel) return privateJson({ ok: false, error: "Name this flower movement." }, 400);
    if (!rawLines.length || rawLines.length > 48) return privateJson({ ok: false, error: "Choose at least one Ready flower line." }, 400);

    const lines = rawLines.map((raw) => {
      const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Json : {};
      return {
        readyLotId: clean(row.readyLotId),
        buyerRelationshipId: clean(row.buyerRelationshipId) || null,
        destinationLabel: clean(row.destinationLabel) || null,
        quantity: quantity(row.quantity),
      };
    });
    if (lines.some((line) => !UUID.test(line.readyLotId) || line.quantity === null || line.quantity <= 0)) {
      return privateJson({ ok: false, error: "Each route line needs valid Ready flowers and a positive quantity." }, 400);
    }

    const result = operatorMembershipId
      ? await supabase.rpc("owner_operator_record_flower_prospect_route_v2", {
          p_effective_membership_id: operatorMembershipId,
          p_assigned_membership_id: assignedMembershipId,
          p_custodian_label: custodianLabel,
          p_route_date: routeDate,
          p_route_label: routeLabel,
          p_lines: lines,
          p_note: note,
          p_idempotency_key: idempotencyKey,
        })
      : await supabase.rpc("record_flower_prospect_route_for_member_v2", {
          p_farm_id: farmId,
          p_assigned_membership_id: assignedMembershipId,
          p_custodian_label: custodianLabel,
          p_route_date: routeDate,
          p_route_label: routeLabel,
          p_lines: lines,
          p_note: note,
          p_idempotency_key: idempotencyKey,
        });

    if (result.error) return rpcFailure(result.error as RpcError);
    return privateJson({ ...(result.data as Json), ok: true, action, operatorMode: operatorContext?.isOperating ?? false });
  }

  if (action === "sell") {
    const farmId = clean(body.farmId) || authorized.access.membership.farmId;
    const prospectRouteLineId = clean(body.prospectRouteLineId);
    const soldQuantity = quantity(body.quantity);
    const unitPrice = quantity(body.unitPrice);
    const customerLabel = clean(body.customerLabel) || null;
    const salesChannel = clean(body.salesChannel) || "wholesale";
    const note = clean(body.note) || null;

    if (!UUID.test(farmId) || !UUID.test(prospectRouteLineId)) return privateJson({ ok: false, error: "A valid route line is required." }, 400);
    if (soldQuantity === null || soldQuantity <= 0 || unitPrice === null || unitPrice < 0) return privateJson({ ok: false, error: "Sold quantity and unit price are required." }, 400);

    const result = operatorMembershipId
      ? await supabase.rpc("owner_operator_record_flower_sale_from_prospect_v1", {
          p_effective_membership_id: operatorMembershipId,
          p_prospect_route_line_id: prospectRouteLineId,
          p_quantity: soldQuantity,
          p_unit_price: unitPrice,
          p_customer_label: customerLabel,
          p_sales_channel: salesChannel,
          p_tax_amount: 0,
          p_tip_amount: 0,
          p_note: note,
          p_idempotency_key: idempotencyKey,
        })
      : await supabase.rpc("record_flower_sale_from_prospect_for_member_v1", {
          p_farm_id: farmId,
          p_prospect_route_line_id: prospectRouteLineId,
          p_quantity: soldQuantity,
          p_unit_price: unitPrice,
          p_customer_label: customerLabel,
          p_sales_channel: salesChannel,
          p_tax_amount: 0,
          p_tip_amount: 0,
          p_note: note,
          p_idempotency_key: idempotencyKey,
        });

    if (result.error) return rpcFailure(result.error as RpcError);
    return privateJson({ ...(result.data as Json), ok: true, action, operatorMode: operatorContext?.isOperating ?? false });
  }

  if (action === "return") {
    const farmId = clean(body.farmId) || authorized.access.membership.farmId;
    const prospectRouteId = clean(body.prospectRouteId);
    const note = clean(body.note) || null;
    if (!UUID.test(farmId) || !UUID.test(prospectRouteId)) return privateJson({ ok: false, error: "A valid route is required." }, 400);

    const result = operatorMembershipId
      ? await supabase.rpc("owner_operator_release_flower_prospect_route_v1", {
          p_effective_membership_id: operatorMembershipId,
          p_prospect_route_id: prospectRouteId,
          p_reason_kind: "returned",
          p_note: note,
          p_idempotency_key: idempotencyKey,
        })
      : await supabase.rpc("release_flower_prospect_route_for_member_v1", {
          p_farm_id: farmId,
          p_prospect_route_id: prospectRouteId,
          p_reason_kind: "returned",
          p_note: note,
          p_idempotency_key: idempotencyKey,
        });

    if (result.error) return rpcFailure(result.error as RpcError);
    return privateJson({ ...(result.data as Json), ok: true, action, operatorMode: operatorContext?.isOperating ?? false });
  }

  return privateJson({ ok: false, error: "Choose send, sell, or return." }, 400);
}
