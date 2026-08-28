import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const HISTORY_DAYS = 45;

type Json = Record<string, unknown>;
type FarmRow = { id: string; stable_key: string; name: string };
type MembershipRow = { id: string; farm_id: string; role: string; worker_key: string | null };
type CycleRow = { id: string; farm_id: string; object_id: string | null; crop_profile_id: string | null; crop_label: string | null; variety: string | null; cycle_state: string | null; lifecycle_status: string | null };
type ProfileRow = { id: string; crop_label: string | null; variety: string | null; metadata: Json | null };
type ObjectRow = { id: string; stable_key: string | null; label: string | null };
type HarvestBatchRow = { id: string; farm_id: string; harvest_date: string; recorded_by_membership_id: string; batch_key: string; note: string | null; metadata: Json | null; created_at: string };
type HarvestObservationRow = { id: string; farm_id: string; batch_id: string; crop_cycle_id: string; task_id: string; recorded_by_membership_id: string; observed_date: string; bucket_equivalent_floor: number | string; bucket_halves: number | null; more_availability: string | null; more_available: boolean | null; note: string | null; metadata: Json | null; created_at: string };
type PrepBatchRow = { id: string; farm_id: string; harvest_batch_id: string; task_id: string; prepared_date: string; recorded_by_membership_id: string; result_kind: string; note: string | null; metadata: Json | null; created_at: string };
type ReadyLotRow = { id: string; farm_id: string; preparation_batch_id: string; inventory_kind: string; quantity: number | string; unit: string; quantity_exactness: string; ready_date: string; metadata: Json | null; crop_profile_id: string | null; product_label: string | null; created_at: string };
type OrderRow = { id: string; farm_id: string; customer_label: string | null; sales_channel: string; event_key: string | null; sale_date: string; fulfillment_mode: string; fulfillment_due_date: string | null; fulfillment_due_time: string | null; fulfillment_membership_id: string | null; total_amount: number | string; source_task_id: string | null; note: string | null; recorded_by_membership_id: string; metadata: Json | null; created_at: string };
type OrderLineRow = { id: string; farm_id: string; sale_order_id: string; ready_lot_id: string; inventory_kind: string; quantity: number | string; unit: string; unit_price: number | string; line_total: number | string; metadata: Json | null; created_at: string };
type FulfillmentRow = { id: string; farm_id: string; sale_order_id: string; task_id: string; fulfilled_at: string; fulfillment_method: string; recorded_by_membership_id: string; note: string | null; metadata: Json | null; created_at: string };
type CancellationRow = { id: string; farm_id: string; sale_order_id: string; reason_kind: string; note: string | null; recorded_by_membership_id: string; metadata: Json | null; created_at: string };
type DispositionRow = { id: string; farm_id: string; ready_lot_id: string; disposition_kind: string; quantity: number | string; unit: string; note: string | null; recorded_by_membership_id: string; metadata: Json | null; created_at: string };
type TaskRow = { id: string; farm_id: string; title: string; task_type: string; status: string; assigned_membership_id: string | null; metadata: Json | null; created_at: string; completed_at: string | null };

type Activity = {
  id: string;
  at: string;
  date: string;
  kind: "harvest" | "ready" | "claim" | "handoff" | "release" | "removed";
  direction: "in" | "out" | "neutral";
  label: string;
  detail: string | null;
  quantity: number | null;
  unit: string | null;
  productKey: string | null;
  productLabel: string | null;
  harvestBatchId: string | null;
  preparationBatchId: string | null;
  readyLotId: string | null;
  orderId: string | null;
  taskId: string | null;
  source: string;
  actor: string;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function localDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metadataText(metadata: Json | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function stemsPerUnit(metadata: Json | null | undefined) {
  const value = metadata?.stemsPerUnit;
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalized(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function productIdentity(lot: ReadyLotRow) {
  const stems = stemsPerUnit(lot.metadata);
  const label = lot.product_label?.trim() || kindLabel(lot.inventory_kind);
  return {
    key: [normalized(label), lot.inventory_kind, lot.unit, stems ?? ""].join("|"),
    label,
    stemsPerUnit: stems,
  };
}

function kindLabel(kind: string) {
  const labels: Record<string, string> = {
    bunch: "Flower bunch",
    posy: "Posy",
    bouquet: "Bouquet",
    lobby_arrangement: "Lobby arrangement",
    conditioned_bucket: "Conditioned flowers",
    counted_stems: "Counted stems",
  };
  return labels[kind] ?? kind.replace(/_/g, " ");
}

function actorLabel(membershipId: string | null | undefined, memberships: Map<string, MembershipRow>) {
  const member = membershipId ? memberships.get(membershipId) : null;
  if (!member) return "Atlas";
  if (member.worker_key) return member.worker_key.charAt(0).toUpperCase() + member.worker_key.slice(1);
  return member.role === "owner" ? "Owner" : member.role === "manager" ? "Manager" : "Farm hand";
}

function sourceLabel(task: TaskRow | undefined, metadata: Json | null | undefined) {
  const directSource = metadataText(metadata, "source");
  const tabSource = metadataText(metadata, "workbenchSource");
  if (tabSource === "harvest_tab" || directSource.includes("workbench")) return "Harvest tab";
  if (task) return `Task · ${task.title}`;
  return directSource ? "Recorded work" : "Atlas";
}

function localDateFromTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : localDate(date);
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);
  const supabase = await createAtlasServerClient();
  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));
  const today = localDate();
  const historyStart = addDays(today, -HISTORY_DAYS);

  const [farmsResult, membershipsResult, cyclesResult, profilesResult, objectsResult] = await Promise.all([
    supabase.from("farms").select("id, stable_key, name").in("id", farmIds),
    supabase.from("farm_memberships").select("id, farm_id, role, worker_key").in("farm_id", farmIds).eq("active", true),
    supabase.from("crop_cycles").select("id, farm_id, object_id, crop_profile_id, crop_label, variety, cycle_state, lifecycle_status").in("farm_id", farmIds).eq("lifecycle_status", "active"),
    supabase.from("crop_profiles").select("id, crop_label, variety, metadata"),
    supabase.from("growing_objects").select("id, stable_key, label").in("farm_id", farmIds),
  ]);

  if (farmsResult.error || membershipsResult.error || cyclesResult.error || profilesResult.error || objectsResult.error) {
    return privateJson({ ok: false, error: "Harvest workbench context could not be loaded." }, 500);
  }

  const [harvestBatchesResult, harvestObservationsResult, prepBatchesResult, readyLotsResult, ordersResult, orderLinesResult, fulfillmentsResult, cancellationsResult, dispositionsResult, tasksResult] = await Promise.all([
    supabase.from("flower_harvest_batches").select("id, farm_id, harvest_date, recorded_by_membership_id, batch_key, note, metadata, created_at").in("farm_id", farmIds).gte("harvest_date", historyStart).order("created_at", { ascending: false }),
    supabase.from("flower_harvest_bucket_observations").select("id, farm_id, batch_id, crop_cycle_id, task_id, recorded_by_membership_id, observed_date, bucket_equivalent_floor, bucket_halves, more_availability, more_available, note, metadata, created_at").in("farm_id", farmIds).gte("observed_date", historyStart).order("created_at", { ascending: false }),
    supabase.from("flower_preparation_batches").select("id, farm_id, harvest_batch_id, task_id, prepared_date, recorded_by_membership_id, result_kind, note, metadata, created_at").in("farm_id", farmIds).gte("prepared_date", historyStart).order("created_at", { ascending: false }),
    supabase.from("flower_ready_inventory_lots").select("id, farm_id, preparation_batch_id, inventory_kind, quantity, unit, quantity_exactness, ready_date, metadata, crop_profile_id, product_label, created_at").in("farm_id", farmIds).order("created_at", { ascending: false }),
    supabase.from("flower_sale_orders").select("id, farm_id, customer_label, sales_channel, event_key, sale_date, fulfillment_mode, fulfillment_due_date, fulfillment_due_time, fulfillment_membership_id, total_amount, source_task_id, note, recorded_by_membership_id, metadata, created_at").in("farm_id", farmIds).order("created_at", { ascending: false }),
    supabase.from("flower_sale_order_lines").select("id, farm_id, sale_order_id, ready_lot_id, inventory_kind, quantity, unit, unit_price, line_total, metadata, created_at").in("farm_id", farmIds).order("created_at", { ascending: false }),
    supabase.from("flower_fulfillment_events").select("id, farm_id, sale_order_id, task_id, fulfilled_at, fulfillment_method, recorded_by_membership_id, note, metadata, created_at").in("farm_id", farmIds).order("created_at", { ascending: false }),
    supabase.from("flower_sale_order_cancellation_events").select("id, farm_id, sale_order_id, reason_kind, note, recorded_by_membership_id, metadata, created_at").in("farm_id", farmIds).order("created_at", { ascending: false }),
    supabase.from("flower_ready_inventory_disposition_events").select("id, farm_id, ready_lot_id, disposition_kind, quantity, unit, note, recorded_by_membership_id, metadata, created_at").in("farm_id", farmIds).order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, farm_id, title, task_type, status, assigned_membership_id, metadata, created_at, completed_at").in("farm_id", farmIds).in("task_type", ["harvest", "crop_harvest", "flower_preparation", "flower_fulfillment", "owner_decision"]).order("created_at", { ascending: false }),
  ]);

  const failures = [harvestBatchesResult, harvestObservationsResult, prepBatchesResult, readyLotsResult, ordersResult, orderLinesResult, fulfillmentsResult, cancellationsResult, dispositionsResult, tasksResult].filter((result) => result.error);
  if (failures.length) return privateJson({ ok: false, error: "Flower history could not be assembled." }, 500);

  const farms = (farmsResult.data ?? []) as FarmRow[];
  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const cycles = (cyclesResult.data ?? []) as CycleRow[];
  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const objects = (objectsResult.data ?? []) as ObjectRow[];
  const harvestBatches = (harvestBatchesResult.data ?? []) as HarvestBatchRow[];
  const observations = (harvestObservationsResult.data ?? []) as HarvestObservationRow[];
  const prepBatches = (prepBatchesResult.data ?? []) as PrepBatchRow[];
  const readyLots = (readyLotsResult.data ?? []) as ReadyLotRow[];
  const orders = (ordersResult.data ?? []) as OrderRow[];
  const orderLines = (orderLinesResult.data ?? []) as OrderLineRow[];
  const fulfillments = (fulfillmentsResult.data ?? []) as FulfillmentRow[];
  const cancellations = (cancellationsResult.data ?? []) as CancellationRow[];
  const dispositions = (dispositionsResult.data ?? []) as DispositionRow[];
  const tasks = (tasksResult.data ?? []) as TaskRow[];

  const membershipById = new Map(memberships.map((row) => [row.id, row]));
  const cycleById = new Map(cycles.map((row) => [row.id, row]));
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const objectById = new Map(objects.map((row) => [row.id, row]));
  const readyById = new Map(readyLots.map((row) => [row.id, row]));
  const orderById = new Map(orders.map((row) => [row.id, row]));
  const taskById = new Map(tasks.map((row) => [row.id, row]));
  const fulfillmentByOrder = new Map(fulfillments.map((row) => [row.sale_order_id, row]));
  const cancellationByOrder = new Map(cancellations.map((row) => [row.sale_order_id, row]));
  const fulfillmentTaskByOrder = new Map<string, TaskRow>();
  for (const task of tasks) {
    if (task.task_type !== "flower_fulfillment") continue;
    const orderId = metadataText(task.metadata, "flower_sale_order_id");
    if (orderId && !fulfillmentTaskByOrder.has(orderId)) fulfillmentTaskByOrder.set(orderId, task);
  }

  const responseFarms = farms.map((farm) => {
    const farmCycles = cycles.filter((cycle) => cycle.farm_id === farm.id);
    const cropOptions = farmCycles.map((cycle) => {
      const profile = cycle.crop_profile_id ? profileById.get(cycle.crop_profile_id) : undefined;
      const useTags = Array.isArray(profile?.metadata?.use_tags) ? profile?.metadata?.use_tags : [];
      const object = cycle.object_id ? objectById.get(cycle.object_id) : undefined;
      return {
        cropCycleId: cycle.id,
        cropProfileId: cycle.crop_profile_id,
        cropLabel: cycle.crop_label?.trim() || profile?.crop_label?.trim() || "Crop",
        variety: cycle.variety?.trim() || profile?.variety?.trim() || null,
        objectLabel: object?.label?.trim() || "Growing area",
        objectKey: object?.stable_key || null,
        useTags,
        cycleState: cycle.cycle_state,
      };
    }).filter((option) => option.useTags.includes("cut_flower") && !option.objectKey?.startsWith("grow_room_") && !["failed", "cleared", "finished", "finished_harvest"].includes((option.cycleState || "").toLowerCase()))
      .sort((a, b) => a.objectLabel.localeCompare(b.objectLabel, undefined, { numeric: true }) || a.cropLabel.localeCompare(b.cropLabel));

    const farmHarvestBatches = harvestBatches.filter((row) => row.farm_id === farm.id);
    const farmObservations = observations.filter((row) => row.farm_id === farm.id);
    const farmPrepBatches = prepBatches.filter((row) => row.farm_id === farm.id);
    const farmReady = readyLots.filter((row) => row.farm_id === farm.id);
    const farmOrders = orders.filter((row) => row.farm_id === farm.id);
    const farmLines = orderLines.filter((row) => row.farm_id === farm.id);
    const farmFulfillments = fulfillments.filter((row) => row.farm_id === farm.id);
    const farmCancellations = cancellations.filter((row) => row.farm_id === farm.id);
    const farmDispositions = dispositions.filter((row) => row.farm_id === farm.id);

    const linesByReady = new Map<string, OrderLineRow[]>();
    for (const line of farmLines) linesByReady.set(line.ready_lot_id, [...(linesByReady.get(line.ready_lot_id) ?? []), line]);
    const dispositionsByReady = new Map<string, DispositionRow[]>();
    for (const event of farmDispositions) dispositionsByReady.set(event.ready_lot_id, [...(dispositionsByReady.get(event.ready_lot_id) ?? []), event]);

    const productMap = new Map<string, {
      key: string; productLabel: string; inventoryKind: string; unit: string; stemsPerUnit: number | null;
      totalBorn: number; madeToday: number; claimed: number; out: number; disposed: number; availableNow: number; lotIds: string[];
    }>();

    const availableLots = farmReady.map((lot) => {
      const identity = productIdentity(lot);
      const activeLines = (linesByReady.get(lot.id) ?? []).filter((line) => !cancellationByOrder.has(line.sale_order_id));
      const committed = activeLines.reduce((sum, line) => sum + number(line.quantity), 0);
      const claimed = activeLines.filter((line) => !fulfillmentByOrder.has(line.sale_order_id)).reduce((sum, line) => sum + number(line.quantity), 0);
      const out = activeLines.filter((line) => fulfillmentByOrder.has(line.sale_order_id)).reduce((sum, line) => sum + number(line.quantity), 0);
      const disposed = (dispositionsByReady.get(lot.id) ?? []).reduce((sum, event) => sum + number(event.quantity), 0);
      const birth = number(lot.quantity);
      const available = Math.max(0, birth - committed - disposed);
      const product = productMap.get(identity.key) ?? {
        key: identity.key, productLabel: identity.label, inventoryKind: lot.inventory_kind, unit: lot.unit, stemsPerUnit: identity.stemsPerUnit,
        totalBorn: 0, madeToday: 0, claimed: 0, out: 0, disposed: 0, availableNow: 0, lotIds: [],
      };
      product.totalBorn += birth;
      if (lot.ready_date === today) product.madeToday += birth;
      product.claimed += claimed;
      product.out += out;
      product.disposed += disposed;
      product.availableNow += available;
      product.lotIds.push(lot.id);
      productMap.set(identity.key, product);
      return {
        id: lot.id,
        productKey: identity.key,
        productLabel: identity.label,
        inventoryKind: lot.inventory_kind,
        quantity: birth,
        unit: lot.unit,
        stemsPerUnit: identity.stemsPerUnit,
        readyDate: lot.ready_date,
        preparationBatchId: lot.preparation_batch_id,
        committedQuantity: committed,
        disposedQuantity: disposed,
        availableQuantity: available,
      };
    }).filter((lot) => lot.availableQuantity > 0);

    const activities: Activity[] = [];
    for (const observation of farmObservations) {
      const cycle = cycleById.get(observation.crop_cycle_id);
      const object = cycle?.object_id ? objectById.get(cycle.object_id) : undefined;
      const task = taskById.get(observation.task_id);
      const crop = cycle?.crop_label?.trim() || "Crop";
      const variety = cycle?.variety?.trim();
      activities.push({
        id: `harvest:${observation.id}`, at: observation.created_at, date: observation.observed_date, kind: "harvest", direction: "in",
        label: variety ? `${crop} · ${variety}` : crop,
        detail: object?.label?.trim() || null,
        quantity: number(observation.bucket_equivalent_floor), unit: "bucket_equivalent", productKey: null, productLabel: null,
        harvestBatchId: observation.batch_id, preparationBatchId: null, readyLotId: null, orderId: null, taskId: observation.task_id,
        source: sourceLabel(task, observation.metadata), actor: actorLabel(observation.recorded_by_membership_id, membershipById),
      });
    }
    for (const lot of farmReady) {
      const identity = productIdentity(lot);
      const prep = farmPrepBatches.find((batch) => batch.id === lot.preparation_batch_id);
      const task = prep ? taskById.get(prep.task_id) : undefined;
      activities.push({
        id: `ready:${lot.id}`, at: lot.created_at, date: lot.ready_date, kind: "ready", direction: "in", label: identity.label,
        detail: identity.stemsPerUnit ? `${identity.stemsPerUnit} stems each` : kindLabel(lot.inventory_kind),
        quantity: number(lot.quantity), unit: lot.unit, productKey: identity.key, productLabel: identity.label,
        harvestBatchId: prep?.harvest_batch_id ?? null, preparationBatchId: lot.preparation_batch_id, readyLotId: lot.id, orderId: null, taskId: prep?.task_id ?? null,
        source: sourceLabel(task, prep?.metadata), actor: actorLabel(prep?.recorded_by_membership_id, membershipById),
      });
    }
    for (const line of farmLines) {
      const order = orderById.get(line.sale_order_id);
      const lot = readyById.get(line.ready_lot_id);
      if (!order || !lot) continue;
      const identity = productIdentity(lot);
      const cancelled = cancellationByOrder.get(order.id);
      activities.push({
        id: `claim:${line.id}`, at: line.created_at, date: order.sale_date, kind: "claim", direction: "out", label: identity.label,
        detail: order.customer_label?.trim() || order.sales_channel.replace(/_/g, " "), quantity: number(line.quantity), unit: line.unit,
        productKey: identity.key, productLabel: identity.label, harvestBatchId: null, preparationBatchId: lot.preparation_batch_id, readyLotId: lot.id,
        orderId: order.id, taskId: order.source_task_id, source: order.source_task_id ? "Task · sale" : "Harvest tab", actor: actorLabel(order.recorded_by_membership_id, membershipById),
      });
      if (cancelled) {
        activities.push({
          id: `release:${cancelled.id}:${line.id}`, at: cancelled.created_at, date: localDateFromTimestamp(cancelled.created_at), kind: "release", direction: "in", label: identity.label,
          detail: `${order.customer_label?.trim() || "Order"} · claim released`, quantity: number(line.quantity), unit: line.unit,
          productKey: identity.key, productLabel: identity.label, harvestBatchId: null, preparationBatchId: lot.preparation_batch_id, readyLotId: lot.id,
          orderId: order.id, taskId: null, source: "Order correction", actor: actorLabel(cancelled.recorded_by_membership_id, membershipById),
        });
      }
    }
    for (const fulfillment of farmFulfillments) {
      const order = orderById.get(fulfillment.sale_order_id);
      if (!order) continue;
      for (const line of farmLines.filter((candidate) => candidate.sale_order_id === order.id)) {
        const lot = readyById.get(line.ready_lot_id);
        if (!lot) continue;
        const identity = productIdentity(lot);
        activities.push({
          id: `handoff:${fulfillment.id}:${line.id}`, at: fulfillment.fulfilled_at, date: localDateFromTimestamp(fulfillment.fulfilled_at), kind: "handoff", direction: "out", label: identity.label,
          detail: order.customer_label?.trim() || "Customer handoff", quantity: number(line.quantity), unit: line.unit,
          productKey: identity.key, productLabel: identity.label, harvestBatchId: null, preparationBatchId: lot.preparation_batch_id, readyLotId: lot.id,
          orderId: order.id, taskId: fulfillment.task_id, source: sourceLabel(taskById.get(fulfillment.task_id), fulfillment.metadata), actor: actorLabel(fulfillment.recorded_by_membership_id, membershipById),
        });
      }
    }
    for (const disposition of farmDispositions) {
      const lot = readyById.get(disposition.ready_lot_id);
      if (!lot) continue;
      const identity = productIdentity(lot);
      activities.push({
        id: `removed:${disposition.id}`, at: disposition.created_at, date: localDateFromTimestamp(disposition.created_at), kind: "removed", direction: "out", label: identity.label,
        detail: disposition.disposition_kind.replace(/_/g, " "), quantity: number(disposition.quantity), unit: disposition.unit,
        productKey: identity.key, productLabel: identity.label, harvestBatchId: null, preparationBatchId: lot.preparation_batch_id, readyLotId: lot.id,
        orderId: null, taskId: null, source: "Inventory correction", actor: actorLabel(disposition.recorded_by_membership_id, membershipById),
      });
    }
    activities.sort((a, b) => b.at.localeCompare(a.at));

    const preparationBatches = farmPrepBatches.map((batch) => {
      const task = taskById.get(batch.task_id);
      const outputs = farmReady.filter((lot) => lot.preparation_batch_id === batch.id).map((lot) => {
        const identity = productIdentity(lot);
        return { id: lot.id, productKey: identity.key, productLabel: identity.label, inventoryKind: lot.inventory_kind, quantity: number(lot.quantity), unit: lot.unit, stemsPerUnit: identity.stemsPerUnit };
      });
      return {
        id: batch.id, preparedDate: batch.prepared_date, createdAt: batch.created_at, harvestBatchId: batch.harvest_batch_id, taskId: batch.task_id,
        actor: actorLabel(batch.recorded_by_membership_id, membershipById), source: sourceLabel(task, batch.metadata), note: batch.note, outputs,
      };
    });

    const harvestRuns = farmHarvestBatches.map((batch) => ({
      id: batch.id, harvestDate: batch.harvest_date, createdAt: batch.created_at, taskId: metadataText(batch.metadata, "workbenchTaskId") || null,
      actor: actorLabel(batch.recorded_by_membership_id, membershipById), source: sourceLabel(undefined, batch.metadata), note: batch.note,
      rows: farmObservations.filter((observation) => observation.batch_id === batch.id).map((observation) => {
        const cycle = cycleById.get(observation.crop_cycle_id);
        const object = cycle?.object_id ? objectById.get(cycle.object_id) : undefined;
        return {
          id: observation.id, cropCycleId: observation.crop_cycle_id, cropLabel: cycle?.crop_label?.trim() || "Crop", variety: cycle?.variety?.trim() || null,
          objectLabel: object?.label?.trim() || "Growing area", bucketEquivalent: number(observation.bucket_equivalent_floor), bucketHalves: observation.bucket_halves,
          moreAvailability: observation.more_availability || (observation.more_available === true ? "yes" : observation.more_available === false ? "no" : "unsure"),
        };
      }),
    }));

    const goingOut = farmOrders.filter((order) => !cancellationByOrder.has(order.id) && !fulfillmentByOrder.has(order.id)).map((order) => {
      const task = fulfillmentTaskByOrder.get(order.id);
      return {
        id: order.id, customerLabel: order.customer_label?.trim() || "Flower customer", salesChannel: order.sales_channel, saleDate: order.sale_date,
        fulfillmentMode: order.fulfillment_mode, fulfillmentDueDate: order.fulfillment_due_date, fulfillmentDueTime: order.fulfillment_due_time,
        fulfillmentTaskId: task?.id ?? null, fulfillmentTaskStatus: task?.status ?? null, totalAmount: number(order.total_amount), note: order.note,
        lines: farmLines.filter((line) => line.sale_order_id === order.id).map((line) => {
          const lot = readyById.get(line.ready_lot_id);
          const identity = lot ? productIdentity(lot) : { key: line.inventory_kind, label: kindLabel(line.inventory_kind), stemsPerUnit: null };
          return { id: line.id, readyLotId: line.ready_lot_id, productKey: identity.key, productLabel: identity.label, quantity: number(line.quantity), unit: line.unit };
        }),
      };
    });

    const products = Array.from(productMap.values()).sort((a, b) => b.availableNow - a.availableNow || a.productLabel.localeCompare(b.productLabel));
    const todayActivity = activities.filter((activity) => activity.date === today);

    return {
      id: farm.id, key: farm.stable_key, name: farm.name,
      cropOptions,
      products,
      availableLots,
      todayActivity,
      activity: activities.filter((activity) => activity.date >= historyStart),
      batches: { harvest: harvestRuns, preparation: preparationBatches },
      goingOut,
      counts: {
        availableProducts: products.filter((product) => product.availableNow > 0).length,
        madeToday: products.reduce((sum, product) => sum + product.madeToday, 0),
        goingOut: goingOut.length,
        activityToday: todayActivity.length,
      },
    };
  });

  return privateJson({ ok: true, contractVersion: "harvest_live_ledger_v1", asOf: today, historyStart, farms: responseFarms });
}
