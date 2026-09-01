import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { effectiveOperatorMembershipId, readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const DEMAND_CANCEL_REASONS = new Set(["customer_cancelled", "seller_cancelled", "entry_correction", "other"]);
const ALLOCATION_RELEASE_REASONS = new Set(["manual_release", "entry_correction", "other"]);

type Body = Record<string, unknown>;
type RpcError = { code?: string; message?: string };
type FarmRow = { id: string; stable_key: string; name: string };
type OrderRow = {
  id: string; farm_id: string; buyer_relationship_id: string | null; customer_label: string | null;
  demand_strength: string; sales_channel: string; requested_for_date: string; fulfillment_mode: string;
  fulfillment_due_time: string | null; note: string | null; created_at: string;
};
type LineRow = {
  id: string; farm_id: string; demand_order_id: string; inventory_kind: string; crop_profile_id: string | null;
  product_label: string | null; quantity: number | string; unit: string; stems_per_unit: number | null;
  target_unit_price: number | string | null; currency: string; created_at: string;
};
type CoverageRow = {
  demand_order_id: string; demand_line_id: string; demanded_quantity: number | string; reserved_quantity: number | string;
  sold_quantity: number | string; fulfilled_quantity: number | string; short_quantity: number | string; coverage_state: string;
  target_demand_value: number | string | null;
};
type AllocationRow = {
  allocation_id: string; farm_id: string; demand_line_id: string; demand_order_id: string; ready_lot_id: string;
  quantity: number | string; allocation_state: string; release_reason: string | null; sale_order_line_id: string | null; created_at: string;
};
type ReadyPositionRow = {
  id: string; farm_id: string; inventory_kind: string; unit: string; quantity_exactness: string; ready_date: string;
  birth_quantity: number | string; active_claimed_quantity: number | string; fulfilled_quantity: number | string;
  disposed_quantity: number | string; available_quantity: number | string; crop_profile_id: string | null; product_label: string | null;
};
type ReadyIdentityRow = {
  id: string; crop_profile_id: string | null; crop_label: string | null; variety: string | null; product_label: string | null; metadata: Record<string, unknown> | null;
};
type CommitmentRow = { id: string; farm_id: string; demand_order_id: string; note: string | null; created_at: string };
type CancellationRow = { demand_order_id: string; reason_kind: string; note: string | null; created_at: string };
type SaleLinkRow = { demand_order_id: string; sale_order_id: string };
type SaleCancellationRow = { sale_order_id: string };
type FulfillmentRow = { sale_order_id: string; fulfilled_at: string; fulfillment_method: string };

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function optionalUuid(value: unknown) { const text = clean(value); return text && UUID_PATTERN.test(text) ? text : null; }
function numeric(value: unknown) { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : NaN; }
function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "flower-demand-workflow-v1" } });
}
function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This flower demand action is outside the active farm context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "Flower demand truth was not found." }, 404);
  if (["22023", "22P02", "23505", "23514", "55000"].includes(error.code || "")) return privateJson({ ok: false, error: error.message || "The flower demand action was rejected." }, 400);
  console.error("Flower demand workflow write failed.", error);
  return privateJson({ ok: false, error: "Flower demand could not be changed." }, 500);
}
function stemsPerUnit(metadata: Record<string, unknown> | null | undefined) {
  const value = Number(metadata?.stemsPerUnit);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);

  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));
  const supabase = await createAtlasServerClient();
  const [farmsResult, ordersResult, linesResult, coverageResult, allocationsResult, readyResult, identityResult, commitmentsResult, cancellationsResult, saleLinksResult, saleCancellationsResult, fulfillmentsResult] = await Promise.all([
    supabase.from("farms").select("id, stable_key, name").in("id", farmIds),
    supabase.from("flower_demand_orders").select("id, farm_id, buyer_relationship_id, customer_label, demand_strength, sales_channel, requested_for_date, fulfillment_mode, fulfillment_due_time, note, created_at").in("farm_id", farmIds).order("requested_for_date", { ascending: true }),
    supabase.from("flower_demand_order_lines").select("id, farm_id, demand_order_id, inventory_kind, crop_profile_id, product_label, quantity, unit, stems_per_unit, target_unit_price, currency, created_at").in("farm_id", farmIds),
    supabase.from("flower_demand_coverage_v1").select("demand_order_id, demand_line_id, demanded_quantity, reserved_quantity, sold_quantity, fulfilled_quantity, short_quantity, coverage_state, target_demand_value").in("farm_id", farmIds),
    supabase.from("flower_demand_allocation_position_v1").select("allocation_id, farm_id, demand_line_id, demand_order_id, ready_lot_id, quantity, allocation_state, release_reason, sale_order_line_id, created_at").in("farm_id", farmIds),
    supabase.from("flower_ready_inventory_position_v1").select("id, farm_id, inventory_kind, unit, quantity_exactness, ready_date, birth_quantity, active_claimed_quantity, fulfilled_quantity, disposed_quantity, available_quantity, crop_profile_id, product_label").in("farm_id", farmIds),
    supabase.from("flower_ready_inventory_identity_v1").select("id, crop_profile_id, crop_label, variety, product_label, metadata").in("farm_id", farmIds),
    supabase.from("flower_demand_commitment_events").select("id, farm_id, demand_order_id, note, created_at").in("farm_id", farmIds),
    supabase.from("flower_demand_order_cancellation_events").select("demand_order_id, reason_kind, note, created_at").in("farm_id", farmIds),
    supabase.from("flower_demand_sale_order_links").select("demand_order_id, sale_order_id").in("farm_id", farmIds),
    supabase.from("flower_sale_order_cancellation_events").select("sale_order_id").in("farm_id", farmIds),
    supabase.from("flower_fulfillment_events").select("sale_order_id, fulfilled_at, fulfillment_method").in("farm_id", farmIds),
  ]);

  const error = farmsResult.error || ordersResult.error || linesResult.error || coverageResult.error || allocationsResult.error || readyResult.error || identityResult.error || commitmentsResult.error || cancellationsResult.error || saleLinksResult.error || saleCancellationsResult.error || fulfillmentsResult.error;
  if (error) {
    console.error("Flower demand workflow read failed.", error);
    return privateJson({ ok: false, error: "Flower demand workflow could not be loaded." }, 500);
  }

  const orders = (ordersResult.data ?? []) as OrderRow[];
  const lines = (linesResult.data ?? []) as LineRow[];
  const coverage = (coverageResult.data ?? []) as CoverageRow[];
  const allocations = (allocationsResult.data ?? []) as AllocationRow[];
  const ready = (readyResult.data ?? []) as ReadyPositionRow[];
  const identities = (identityResult.data ?? []) as ReadyIdentityRow[];
  const commitments = (commitmentsResult.data ?? []) as CommitmentRow[];
  const cancellations = (cancellationsResult.data ?? []) as CancellationRow[];
  const saleLinks = (saleLinksResult.data ?? []) as SaleLinkRow[];
  const saleCancellations = new Set(((saleCancellationsResult.data ?? []) as SaleCancellationRow[]).map((row) => row.sale_order_id));
  const fulfillmentBySale = new Map(((fulfillmentsResult.data ?? []) as FulfillmentRow[]).map((row) => [row.sale_order_id, row]));

  const commitmentByOrder = new Map(commitments.map((row) => [row.demand_order_id, row]));
  const cancellationByOrder = new Map(cancellations.map((row) => [row.demand_order_id, row]));
  const coverageByLine = new Map(coverage.map((row) => [row.demand_line_id, row]));
  const allocationsByLine = new Map<string, AllocationRow[]>();
  for (const allocation of allocations) allocationsByLine.set(allocation.demand_line_id, [...(allocationsByLine.get(allocation.demand_line_id) ?? []), allocation]);
  const linesByOrder = new Map<string, LineRow[]>();
  for (const line of lines) linesByOrder.set(line.demand_order_id, [...(linesByOrder.get(line.demand_order_id) ?? []), line]);
  const linksByOrder = new Map<string, SaleLinkRow[]>();
  for (const link of saleLinks) linksByOrder.set(link.demand_order_id, [...(linksByOrder.get(link.demand_order_id) ?? []), link]);
  const identityByLot = new Map(identities.map((row) => [row.id, row]));

  const farms = ((farmsResult.data ?? []) as FarmRow[]).map((farm) => {
    const readyLots = ready
      .filter((row) => row.farm_id === farm.id && Number(row.available_quantity) > 0)
      .map((row) => {
        const identity = identityByLot.get(row.id);
        return {
          id: row.id,
          inventoryKind: row.inventory_kind,
          cropProfileId: row.crop_profile_id,
          cropLabel: identity?.crop_label ?? null,
          variety: identity?.variety ?? null,
          productLabel: row.product_label ?? identity?.product_label ?? identity?.crop_label ?? row.inventory_kind.replaceAll("_", " "),
          unit: row.unit,
          stemsPerUnit: stemsPerUnit(identity?.metadata),
          quantityExactness: row.quantity_exactness,
          readyDate: row.ready_date,
          birthQuantity: Number(row.birth_quantity),
          availableQuantity: Number(row.available_quantity),
        };
      });

    const farmOrders = orders.filter((row) => row.farm_id === farm.id).map((order) => {
      const commitment = commitmentByOrder.get(order.id) ?? null;
      const cancellation = cancellationByOrder.get(order.id) ?? null;
      const effectiveDemandStrength = order.demand_strength === "committed" || commitment ? "committed" : "requested";
      const activeSaleLink = (linksByOrder.get(order.id) ?? []).find((link) => !saleCancellations.has(link.sale_order_id)) ?? null;
      const fulfillment = activeSaleLink ? fulfillmentBySale.get(activeSaleLink.sale_order_id) ?? null : null;
      const orderLines = (linesByOrder.get(order.id) ?? []).map((line) => {
        const position = coverageByLine.get(line.id);
        return {
          id: line.id,
          inventoryKind: line.inventory_kind,
          cropProfileId: line.crop_profile_id,
          productLabel: line.product_label ?? line.inventory_kind.replaceAll("_", " "),
          quantity: Number(line.quantity),
          unit: line.unit,
          stemsPerUnit: line.stems_per_unit,
          targetUnitPrice: line.target_unit_price === null ? null : Number(line.target_unit_price),
          currency: line.currency,
          demandedQuantity: Number(position?.demanded_quantity ?? line.quantity),
          reservedQuantity: Number(position?.reserved_quantity ?? 0),
          soldQuantity: Number(position?.sold_quantity ?? 0),
          fulfilledQuantity: Number(position?.fulfilled_quantity ?? 0),
          shortQuantity: Number(position?.short_quantity ?? line.quantity),
          coverageState: position?.coverage_state ?? "short",
          allocations: (allocationsByLine.get(line.id) ?? []).map((allocation) => ({
            id: allocation.allocation_id,
            readyLotId: allocation.ready_lot_id,
            quantity: Number(allocation.quantity),
            state: allocation.allocation_state,
            releaseReason: allocation.release_reason,
            saleOrderLineId: allocation.sale_order_line_id,
            createdAt: allocation.created_at,
          })),
        };
      });
      const allCovered = orderLines.length > 0 && orderLines.every((line) => line.coverageState === "covered");
      const anyReserved = orderLines.some((line) => line.reservedQuantity > 0);
      const allPriced = orderLines.length > 0 && orderLines.every((line) => line.targetUnitPrice !== null);
      const lifecycleState = cancellation ? "cancelled" : fulfillment ? "fulfilled" : activeSaleLink ? "sold" : allCovered ? "covered" : anyReserved ? "partially_reserved" : "short";
      return {
        id: order.id,
        buyerRelationshipId: order.buyer_relationship_id,
        customerLabel: order.customer_label || "Flower customer",
        recordedDemandStrength: order.demand_strength,
        effectiveDemandStrength,
        salesChannel: order.sales_channel,
        requestedForDate: order.requested_for_date,
        fulfillmentMode: order.fulfillment_mode,
        fulfillmentDueTime: order.fulfillment_due_time,
        note: order.note,
        createdAt: order.created_at,
        lifecycleState,
        allCovered,
        allPriced,
        commitment: commitment ? { id: commitment.id, note: commitment.note, committedAt: commitment.created_at } : null,
        cancellation: cancellation ? { reasonKind: cancellation.reason_kind, note: cancellation.note, cancelledAt: cancellation.created_at } : null,
        sale: activeSaleLink ? { saleOrderId: activeSaleLink.sale_order_id, fulfilledAt: fulfillment?.fulfilled_at ?? null, fulfillmentMethod: fulfillment?.fulfillment_method ?? null } : null,
        lines: orderLines,
      };
    });

    return { id: farm.id, key: farm.stable_key, name: farm.name, readyLots, orders: farmOrders };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return privateJson({ ok: true, farms });
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) return privateJson({ ok: false, error: "Flower demand writes require a same-origin Atlas request." }, 403);

  let body: Body;
  try { body = await request.json() as Body; } catch { return privateJson({ ok: false, error: "A JSON flower demand action is required." }, 400); }

  const action = clean(body.action);
  const farmId = clean(body.farmId);
  const idempotencyKey = clean(body.idempotencyKey);
  if (!UUID_PATTERN.test(farmId)) return privateJson({ ok: false, error: "A valid farm is required." }, 400);
  if (!idempotencyKey) return privateJson({ ok: false, error: "An idempotency key is required." }, 400);

  const authorized = await requireAtlasApiAccess({ farmId });
  if (!authorized.ok) return authorized.response;

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) return privateJson({ ok: false, error: "The selected account has no flower-demand scope." }, 403);

  const supabase = await createAtlasServerClient();
  const note = clean(body.note) || null;
  let response;

  if (action === "commit") {
    const demandOrderId = clean(body.demandOrderId);
    if (!UUID_PATTERN.test(demandOrderId)) return privateJson({ ok: false, error: "A valid demand order is required." }, 400);
    response = operatorMembershipId
      ? await supabase.rpc("owner_operator_commit_flower_demand_order_v1", { p_effective_membership_id: operatorMembershipId, p_demand_order_id: demandOrderId, p_note: note, p_idempotency_key: idempotencyKey })
      : await supabase.rpc("commit_flower_demand_order_for_member_v1", { p_farm_id: farmId, p_demand_order_id: demandOrderId, p_note: note, p_idempotency_key: idempotencyKey });
  } else if (action === "allocate") {
    const demandLineId = clean(body.demandLineId);
    const readyLotId = clean(body.readyLotId);
    const quantity = numeric(body.quantity);
    if (!UUID_PATTERN.test(demandLineId) || !UUID_PATTERN.test(readyLotId) || !Number.isFinite(quantity) || quantity <= 0) return privateJson({ ok: false, error: "Allocation needs a demand line, Ready lot, and positive quantity." }, 400);
    response = operatorMembershipId
      ? await supabase.rpc("owner_operator_record_flower_demand_allocation_v1", { p_effective_membership_id: operatorMembershipId, p_demand_line_id: demandLineId, p_ready_lot_id: readyLotId, p_quantity: quantity, p_note: note, p_idempotency_key: idempotencyKey })
      : await supabase.rpc("record_flower_demand_allocation_for_member_v1", { p_farm_id: farmId, p_demand_line_id: demandLineId, p_ready_lot_id: readyLotId, p_quantity: quantity, p_note: note, p_idempotency_key: idempotencyKey });
  } else if (action === "release") {
    const allocationId = clean(body.allocationId);
    const reasonKind = clean(body.reasonKind) || "manual_release";
    if (!UUID_PATTERN.test(allocationId) || !ALLOCATION_RELEASE_REASONS.has(reasonKind)) return privateJson({ ok: false, error: "Choose a valid reservation and release reason." }, 400);
    response = operatorMembershipId
      ? await supabase.rpc("owner_operator_release_flower_demand_allocation_v1", { p_effective_membership_id: operatorMembershipId, p_allocation_id: allocationId, p_reason_kind: reasonKind, p_note: note, p_idempotency_key: idempotencyKey })
      : await supabase.rpc("release_flower_demand_allocation_for_member_v1", { p_farm_id: farmId, p_allocation_id: allocationId, p_reason_kind: reasonKind, p_note: note, p_idempotency_key: idempotencyKey });
  } else if (action === "convert") {
    const demandOrderId = clean(body.demandOrderId);
    const taxAmount = numeric(body.taxAmount ?? 0);
    const tipAmount = numeric(body.tipAmount ?? 0);
    const fulfillmentMembershipId = optionalUuid(body.fulfillmentMembershipId);
    const sourceTaskId = optionalUuid(body.sourceTaskId);
    if (!UUID_PATTERN.test(demandOrderId) || !Number.isFinite(taxAmount) || taxAmount < 0 || !Number.isFinite(tipAmount) || tipAmount < 0) return privateJson({ ok: false, error: "Sale conversion needs a valid demand order and non-negative tax/tip amounts." }, 400);
    response = operatorMembershipId
      ? await supabase.rpc("owner_operator_record_flower_sale_from_demand_v1", { p_effective_membership_id: operatorMembershipId, p_demand_order_id: demandOrderId, p_tax_amount: taxAmount, p_tip_amount: tipAmount, p_fulfillment_membership_id: fulfillmentMembershipId, p_source_task_id: sourceTaskId, p_note: note, p_idempotency_key: idempotencyKey })
      : await supabase.rpc("record_flower_sale_from_demand_for_member_v1", { p_farm_id: farmId, p_demand_order_id: demandOrderId, p_tax_amount: taxAmount, p_tip_amount: tipAmount, p_fulfillment_membership_id: fulfillmentMembershipId, p_source_task_id: sourceTaskId, p_note: note, p_idempotency_key: idempotencyKey });
  } else if (action === "cancel") {
    const demandOrderId = clean(body.demandOrderId);
    const reasonKind = clean(body.reasonKind) || "seller_cancelled";
    if (!UUID_PATTERN.test(demandOrderId) || !DEMAND_CANCEL_REASONS.has(reasonKind)) return privateJson({ ok: false, error: "Choose a valid demand order and cancellation reason." }, 400);
    response = operatorMembershipId
      ? await supabase.rpc("owner_operator_cancel_flower_demand_order_v1", { p_effective_membership_id: operatorMembershipId, p_demand_order_id: demandOrderId, p_reason_kind: reasonKind, p_note: note, p_idempotency_key: idempotencyKey })
      : await supabase.rpc("cancel_flower_demand_order_for_member_v1", { p_farm_id: farmId, p_demand_order_id: demandOrderId, p_reason_kind: reasonKind, p_note: note, p_idempotency_key: idempotencyKey });
  } else {
    return privateJson({ ok: false, error: "Choose a supported flower demand action." }, 400);
  }

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) return privateJson({ ok: false, error: "Atlas returned an invalid flower demand result." }, 500);
  return privateJson({ ...(response.data as Record<string, unknown>), ok: true, operatorMode: operatorContext?.isOperating ?? false, effectiveMembershipId: operatorMembershipId });
}
