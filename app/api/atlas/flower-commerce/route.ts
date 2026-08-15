import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { effectiveOperatorMembershipId, readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const CHANNELS = new Set(["wholesale", "farm_pickup", "delivery", "market", "subscription", "event", "other"]);
const FULFILLMENT_MODES = new Set(["immediate_handoff", "pickup", "delivery"]);

type Body = Record<string, unknown>;
type RpcError = { code?: string; message?: string };
type FarmRow = { id: string; stable_key: string; name: string };
type ReadyRow = { id: string; farm_id: string; inventory_kind: string; quantity: number | string; unit: string; quantity_exactness: string; ready_date: string };
type OrderRow = { id: string; farm_id: string; buyer_relationship_id: string | null; customer_label: string | null; sales_channel: string; event_key: string | null; sale_date: string; fulfillment_mode: string; fulfillment_due_date: string | null; fulfillment_due_time: string | null; subtotal_amount: number | string; tax_amount: number | string; tip_amount: number | string; total_amount: number | string; note: string | null; created_at: string };
type LineRow = { id: string; farm_id: string; sale_order_id: string; ready_lot_id: string; inventory_kind: string; quantity: number | string; unit: string; unit_price: number | string; line_total: number | string };
type FulfillmentRow = { id: string; farm_id: string; sale_order_id: string; fulfilled_at: string; fulfillment_method: string; note: string | null };
type BuyerOption = { id: string; businessName: string; buyerType: string | null; relationshipStatus: string | null; priorityRank: number | null };
type MemberRow = { id: string; farm_id: string; role: string; worker_key: string | null };

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function optionalUuid(value: unknown) { const text = clean(value); return text && UUID_PATTERN.test(text) ? text : null; }
function money(value: unknown) { const parsed = typeof value === "number" ? value : Number(value ?? 0); return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN; }
function privateJson(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "flower-commercial-truth-v1" } }); }

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This sale is outside the active farm context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "Commercial source was not found." }, 404);
  if (["22023", "22P02", "23505", "23514"].includes(error.code || "")) return privateJson({ ok: false, error: error.message || "The flower sale was rejected." }, 400);
  console.error("Flower commercial write failed.", error);
  return privateJson({ ok: false, error: "Flower sale could not be recorded." }, 500);
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);
  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));
  const supabase = await createAtlasServerClient();

  const [farmsResult, readyResult, ordersResult, linesResult, fulfillmentResult, membersResult, buyerResults] = await Promise.all([
    supabase.from("farms").select("id, stable_key, name").in("id", farmIds),
    supabase.from("flower_ready_inventory_lots").select("id, farm_id, inventory_kind, quantity, unit, quantity_exactness, ready_date").in("farm_id", farmIds).order("ready_date", { ascending: false }),
    supabase.from("flower_sale_orders").select("id, farm_id, buyer_relationship_id, customer_label, sales_channel, event_key, sale_date, fulfillment_mode, fulfillment_due_date, fulfillment_due_time, subtotal_amount, tax_amount, tip_amount, total_amount, note, created_at").in("farm_id", farmIds).order("created_at", { ascending: false }),
    supabase.from("flower_sale_order_lines").select("id, farm_id, sale_order_id, ready_lot_id, inventory_kind, quantity, unit, unit_price, line_total").in("farm_id", farmIds),
    supabase.from("flower_fulfillment_events").select("id, farm_id, sale_order_id, fulfilled_at, fulfillment_method, note").in("farm_id", farmIds).order("fulfilled_at", { ascending: false }),
    supabase.from("farm_memberships").select("id, farm_id, role, worker_key").in("farm_id", farmIds).eq("active", true),
    Promise.all(farmIds.map(async (farmId) => ({ farmId, result: await supabase.rpc("flower_sale_buyer_options_v1", { p_farm_id: farmId }) }))),
  ]);

  const error = farmsResult.error || readyResult.error || ordersResult.error || linesResult.error || fulfillmentResult.error || membersResult.error || buyerResults.find(({ result }) => result.error)?.result.error;
  if (error) return privateJson({ ok: false, error: "Flower commercial truth could not be loaded." }, 500);

  const ready = (readyResult.data ?? []) as ReadyRow[];
  const orders = (ordersResult.data ?? []) as OrderRow[];
  const lines = (linesResult.data ?? []) as LineRow[];
  const fulfillments = (fulfillmentResult.data ?? []) as FulfillmentRow[];
  const members = (membersResult.data ?? []) as MemberRow[];
  const buyersByFarm = new Map<string, BuyerOption[]>();
  for (const { farmId, result } of buyerResults) buyersByFarm.set(farmId, Array.isArray(result.data) ? result.data as BuyerOption[] : []);
  const buyerById = new Map<string, BuyerOption>();
  for (const buyers of buyersByFarm.values()) for (const buyer of buyers) buyerById.set(buyer.id, buyer);

  const claimedByLot = new Map<string, number>();
  for (const line of lines) claimedByLot.set(line.ready_lot_id, (claimedByLot.get(line.ready_lot_id) ?? 0) + Number(line.quantity));
  const linesByOrder = new Map<string, LineRow[]>();
  for (const line of lines) linesByOrder.set(line.sale_order_id, [...(linesByOrder.get(line.sale_order_id) ?? []), line]);
  const fulfillmentByOrder = new Map(fulfillments.map((row) => [row.sale_order_id, row]));

  const farms = ((farmsResult.data ?? []) as FarmRow[]).map((farm) => {
    const available = ready.filter((lot) => lot.farm_id === farm.id).map((lot) => {
      const birthQuantity = Number(lot.quantity);
      const committedQuantity = claimedByLot.get(lot.id) ?? 0;
      return { id: lot.id, inventoryKind: lot.inventory_kind, unit: lot.unit, quantityExactness: lot.quantity_exactness, readyDate: lot.ready_date, birthQuantity, committedQuantity, availableQuantity: Math.max(0, birthQuantity - committedQuantity) };
    }).filter((lot) => lot.availableQuantity > 0);

    const decorateOrder = (order: OrderRow) => ({
      id: order.id,
      customerLabel: order.customer_label || (order.buyer_relationship_id ? buyerById.get(order.buyer_relationship_id)?.businessName : null) || "Flower customer",
      buyerRelationshipId: order.buyer_relationship_id,
      salesChannel: order.sales_channel,
      eventKey: order.event_key,
      saleDate: order.sale_date,
      fulfillmentMode: order.fulfillment_mode,
      fulfillmentDueDate: order.fulfillment_due_date,
      fulfillmentDueTime: order.fulfillment_due_time,
      subtotalAmount: Number(order.subtotal_amount),
      taxAmount: Number(order.tax_amount),
      tipAmount: Number(order.tip_amount),
      totalAmount: Number(order.total_amount),
      lines: (linesByOrder.get(order.id) ?? []).map((line) => ({ id: line.id, readyLotId: line.ready_lot_id, inventoryKind: line.inventory_kind, quantity: Number(line.quantity), unit: line.unit, unitPrice: Number(line.unit_price), lineTotal: Number(line.line_total) })),
      fulfillment: fulfillmentByOrder.get(order.id) ? { id: fulfillmentByOrder.get(order.id)!.id, fulfilledAt: fulfillmentByOrder.get(order.id)!.fulfilled_at, method: fulfillmentByOrder.get(order.id)!.fulfillment_method } : null,
    });

    const farmOrders = orders.filter((order) => order.farm_id === farm.id);
    return {
      id: farm.id,
      key: farm.stable_key,
      name: farm.name,
      available,
      goingOut: farmOrders.filter((order) => !fulfillmentByOrder.has(order.id)).map(decorateOrder),
      fulfilled: farmOrders.filter((order) => fulfillmentByOrder.has(order.id)).slice(0, 30).map(decorateOrder),
      buyers: buyersByFarm.get(farm.id) ?? [],
      members: members.filter((member) => member.farm_id === farm.id).map((member) => ({ id: member.id, role: member.role, workerKey: member.worker_key, displayName: member.worker_key ? member.worker_key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : member.role.replace("_", " ") })),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  return privateJson({ ok: true, farms });
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) return privateJson({ ok: false, error: "Flower sales require a same-origin Atlas request." }, 403);

  let body: Body;
  try { body = await request.json() as Body; } catch { return privateJson({ ok: false, error: "A JSON flower sale is required." }, 400); }
  const farmId = clean(body.farmId);
  if (!UUID_PATTERN.test(farmId)) return privateJson({ ok: false, error: "A valid farm is required." }, 400);
  const authorized = await requireAtlasApiAccess({ farmId });
  if (!authorized.ok) return authorized.response;

  const salesChannel = clean(body.salesChannel);
  const fulfillmentMode = clean(body.fulfillmentMode);
  const buyerRelationshipId = optionalUuid(body.buyerRelationshipId);
  const fulfillmentMembershipId = optionalUuid(body.fulfillmentMembershipId);
  const sourceTaskId = optionalUuid(body.sourceTaskId);
  const taxAmount = money(body.taxAmount);
  const tipAmount = money(body.tipAmount);
  const fulfillmentDueDate = clean(body.fulfillmentDueDate) || null;
  const fulfillmentDueTime = clean(body.fulfillmentDueTime) || null;
  const idempotencyKey = clean(body.idempotencyKey);
  if (!CHANNELS.has(salesChannel)) return privateJson({ ok: false, error: "Choose a valid sales channel." }, 400);
  if (!FULFILLMENT_MODES.has(fulfillmentMode)) return privateJson({ ok: false, error: "Choose a valid fulfillment mode." }, 400);
  if (!Number.isFinite(taxAmount) || taxAmount < 0 || !Number.isFinite(tipAmount) || tipAmount < 0) return privateJson({ ok: false, error: "Tax and tip must be valid non-negative amounts." }, 400);
  if (!idempotencyKey) return privateJson({ ok: false, error: "An idempotency key is required." }, 400);
  if (fulfillmentMode !== "immediate_handoff" && !/^\d{4}-\d{2}-\d{2}$/.test(fulfillmentDueDate || "")) return privateJson({ ok: false, error: "Pickup or delivery requires a due date." }, 400);

  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 24) return privateJson({ ok: false, error: "Choose between 1 and 24 Ready inventory lines." }, 400);
  const lines: Array<{ readyLotId: string; quantity: number; unitPrice: number }> = [];
  for (const candidate of body.lines) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return privateJson({ ok: false, error: "Sale lines are invalid." }, 400);
    const row = candidate as Record<string, unknown>;
    const readyLotId = clean(row.readyLotId);
    const quantity = Number(row.quantity);
    const unitPrice = money(row.unitPrice);
    if (!UUID_PATTERN.test(readyLotId) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return privateJson({ ok: false, error: "Each sale line needs a Ready lot, positive quantity, and non-negative unit price." }, 400);
    lines.push({ readyLotId, quantity, unitPrice });
  }
  if (new Set(lines.map((line) => line.readyLotId)).size !== lines.length) return privateJson({ ok: false, error: "A Ready lot may appear only once in a sale." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) return privateJson({ ok: false, error: "The selected account has no flower-sales scope." }, 403);

  const args = {
    p_buyer_relationship_id: buyerRelationshipId,
    p_customer_label: clean(body.customerLabel) || null,
    p_sales_channel: salesChannel,
    p_event_key: clean(body.eventKey) || null,
    p_lines: lines,
    p_tax_amount: taxAmount,
    p_tip_amount: tipAmount,
    p_fulfillment_mode: fulfillmentMode,
    p_fulfillment_due_date: fulfillmentMode === "immediate_handoff" ? null : fulfillmentDueDate,
    p_fulfillment_due_time: fulfillmentMode === "immediate_handoff" ? null : fulfillmentDueTime,
    p_fulfillment_membership_id: fulfillmentMode === "immediate_handoff" ? null : fulfillmentMembershipId,
    p_source_task_id: sourceTaskId,
    p_note: clean(body.note) || null,
    p_idempotency_key: idempotencyKey,
  };
  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_flower_sale_v1", { p_effective_membership_id: operatorMembershipId, ...args })
    : await supabase.rpc("record_flower_sale_for_member_v1", { p_farm_id: farmId, ...args });
  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) return privateJson({ ok: false, error: "Atlas returned an invalid sale result." }, 500);
  return privateJson({ ...(response.data as Record<string, unknown>), ok: true, operatorMode: operatorContext?.isOperating ?? false, effectiveMembershipId: operatorMembershipId });
}
