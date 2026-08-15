import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type TaskRow = { id: string; farm_id: string; due_date: string | null; task_type: string; metadata: Record<string, unknown> | null };
type OrderRow = { id: string; farm_id: string; buyer_relationship_id: string | null; customer_label: string | null; sales_channel: string; event_key: string | null; sale_date: string; fulfillment_mode: string; fulfillment_due_date: string | null; fulfillment_due_time: string | null; total_amount: number | string; note: string | null };
type LineRow = { id: string; inventory_kind: string; quantity: number | string; unit: string; unit_price: number | string; line_total: number | string };
type BuyerRow = { id: string; business_name: string };
function privateJson(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);
  const taskId = new URL(request.url).searchParams.get("taskId")?.trim() || "";
  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid fulfillment task id is required." }, 400);
  const supabase = await createAtlasServerClient();
  const taskResult = await supabase.from("tasks").select("id, farm_id, due_date, task_type, metadata").eq("id", taskId).limit(1).maybeSingle();
  if (taskResult.error) return privateJson({ ok: false, error: "Fulfillment task could not be loaded." }, 500);
  const task = taskResult.data as TaskRow | null;
  if (!task) return privateJson({ ok: false, error: "Fulfillment task was not found." }, 404);
  if (task.task_type !== "flower_fulfillment") return privateJson({ ok: false, error: "Task is not flower fulfillment." }, 400);
  if (!session.memberships.some((membership) => membership.farmId === task.farm_id)) return privateJson({ ok: false, error: "This fulfillment is outside the signed-in farm scope." }, 403);
  const saleOrderId = text(task.metadata?.flower_sale_order_id);
  if (!UUID_PATTERN.test(saleOrderId)) return privateJson({ ok: false, error: "Fulfillment task has no valid sale order." }, 500);

  const [orderResult, linesResult, fulfillmentResult] = await Promise.all([
    supabase.from("flower_sale_orders").select("id, farm_id, buyer_relationship_id, customer_label, sales_channel, event_key, sale_date, fulfillment_mode, fulfillment_due_date, fulfillment_due_time, total_amount, note").eq("id", saleOrderId).eq("farm_id", task.farm_id).limit(1).maybeSingle(),
    supabase.from("flower_sale_order_lines").select("id, inventory_kind, quantity, unit, unit_price, line_total").eq("sale_order_id", saleOrderId).eq("farm_id", task.farm_id).order("created_at", { ascending: true }),
    supabase.from("flower_fulfillment_events").select("id, fulfilled_at").eq("sale_order_id", saleOrderId).eq("farm_id", task.farm_id).limit(1).maybeSingle(),
  ]);
  if (orderResult.error || linesResult.error || fulfillmentResult.error) return privateJson({ ok: false, error: "Flower order context could not be loaded." }, 500);
  const order = orderResult.data as OrderRow | null;
  if (!order) return privateJson({ ok: false, error: "Flower sale order was not found." }, 404);
  if (fulfillmentResult.data) return privateJson({ ok: false, error: "This flower order is already fulfilled." }, 409);

  let buyer: BuyerRow | null = null;
  if (order.buyer_relationship_id) {
    const buyerResult = await supabase.from("buyer_relationship_reconstruction").select("id, business_name").eq("id", order.buyer_relationship_id).eq("farm_id", task.farm_id).limit(1).maybeSingle();
    if (buyerResult.error) return privateJson({ ok: false, error: "Buyer identity could not be loaded." }, 500);
    buyer = buyerResult.data as BuyerRow | null;
  }

  return privateJson({
    ok: true,
    task: {
      id: task.id,
      dueDate: task.due_date,
      saleOrderId: order.id,
      customerLabel: order.customer_label || buyer?.business_name || "Flower customer",
      salesChannel: order.sales_channel,
      eventKey: order.event_key,
      saleDate: order.sale_date,
      fulfillmentMode: order.fulfillment_mode,
      fulfillmentDueDate: order.fulfillment_due_date,
      fulfillmentDueTime: order.fulfillment_due_time,
      totalAmount: Number(order.total_amount),
      note: order.note,
      lines: ((linesResult.data ?? []) as LineRow[]).map((line) => ({ id: line.id, inventoryKind: line.inventory_kind, quantity: Number(line.quantity), unit: line.unit, unitPrice: Number(line.unit_price), lineTotal: Number(line.line_total) })),
    },
  });
}
