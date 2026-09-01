"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import styles from "./FlowerDemandSection.module.css";

type Allocation = {
  id: string;
  readyLotId: string;
  quantity: number;
  state: string;
  releaseReason: string | null;
  saleOrderLineId: string | null;
  createdAt: string;
};

type DemandLine = {
  id: string;
  inventoryKind: string;
  cropProfileId: string | null;
  productLabel: string;
  quantity: number;
  unit: string;
  stemsPerUnit: number | null;
  recordedTargetUnitPrice: number | null;
  targetUnitPrice: number | null;
  currency: string;
  demandedQuantity: number;
  reservedQuantity: number;
  soldQuantity: number;
  fulfilledQuantity: number;
  shortQuantity: number;
  coverageState: string;
  allocations: Allocation[];
};

type DemandOrder = {
  id: string;
  customerLabel: string;
  recordedDemandStrength: string;
  effectiveDemandStrength: "requested" | "committed";
  salesChannel: string;
  requestedForDate: string;
  fulfillmentMode: string;
  fulfillmentDueTime: string | null;
  note: string | null;
  lifecycleState: string;
  allCovered: boolean;
  allPriced: boolean;
  cancellation: { reasonKind: string; note: string | null; cancelledAt: string } | null;
  sale: { saleOrderId: string; fulfilledAt: string | null; fulfillmentMethod: string | null } | null;
  lines: DemandLine[];
};

type ReadyLot = {
  id: string;
  inventoryKind: string;
  cropProfileId: string | null;
  cropLabel: string | null;
  variety: string | null;
  productLabel: string;
  unit: string;
  stemsPerUnit: number | null;
  readyDate: string;
  availableQuantity: number;
};

type DemandFarm = { id: string; key: string; name: string; readyLots: ReadyLot[]; orders: DemandOrder[] };
type DemandResponse = { ok?: boolean; error?: string; farms?: DemandFarm[] };
type AllocationDraft = { readyLotId: string; quantity: string };

function prettyDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function quantityLabel(quantity: number, unit: string, stemsPerUnit: number | null) {
  const value = Number.isInteger(quantity) ? quantity.toFixed(0) : quantity.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  if (unit === "bucket_equivalent") return `${value} bucket${quantity === 1 ? "" : "s"}`;
  if (unit === "bunch") return `${value} bunch${quantity === 1 ? "" : "es"}${stemsPerUnit ? ` × ${stemsPerUnit} stems` : ""}`;
  if (unit === "posy") return `${value} ${quantity === 1 ? "posy" : "posies"}`;
  return `${value} ${unit.replaceAll("_", " ")}${quantity === 1 ? "" : "s"}`;
}

function money(value: number | null) {
  return value === null ? "Price not set" : `$${value.toFixed(2)}`;
}

function statusLabel(order: DemandOrder) {
  if (order.lifecycleState === "fulfilled") return "Fulfilled";
  if (order.lifecycleState === "sold") return "Sale recorded";
  if (order.lifecycleState === "cancelled") return "Cancelled";
  if (order.lifecycleState === "covered") return "Fully reserved";
  if (order.lifecycleState === "partially_reserved") return "Partially reserved";
  return "Needs inventory";
}

function lotMatches(line: DemandLine, lot: ReadyLot) {
  if (lot.availableQuantity <= 0) return false;
  if (lot.inventoryKind !== line.inventoryKind || lot.unit !== line.unit) return false;
  if (line.cropProfileId && lot.cropProfileId !== line.cropProfileId) return false;
  if (line.inventoryKind === "bundle" && lot.stemsPerUnit !== line.stemsPerUnit) return false;
  return true;
}

export default function FlowerDemandSection() {
  const [data, setData] = useState<DemandResponse | null>(null);
  const [farmId, setFarmId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, AllocationDraft>>({});
  const idempotency = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/atlas/flower-demand-workflow", { cache: "no-store" });
      const payload = await response.json() as DemandResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Flower demand could not be loaded.");
      setData(payload);
      const firstFarmId = payload.farms?.[0]?.id || "";
      setFarmId((current) => current || firstFarmId);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Flower demand could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const farm = data?.farms?.find((item) => item.id === farmId) ?? data?.farms?.[0] ?? null;
  const openOrders = useMemo(() => (farm?.orders ?? []).filter((order) => !["fulfilled", "cancelled"].includes(order.lifecycleState)), [farm]);
  const closedOrders = useMemo(() => (farm?.orders ?? []).filter((order) => ["fulfilled", "cancelled"].includes(order.lifecycleState)), [farm]);

  function actionKey(action: string, entityId: string) {
    const identity = `${action}:${entityId}`;
    let key = idempotency.current.get(identity);
    if (!key) {
      key = `flower-demand:${identity}:${crypto.randomUUID()}`;
      idempotency.current.set(identity, key);
    }
    return { identity, key };
  }

  async function runAction(action: string, entityId: string, body: Record<string, unknown>, success: string) {
    if (!farm || saving) return;
    const { identity, key } = actionKey(action, entityId);
    try {
      setSaving(identity);
      setMessage(null);
      const response = await fetch("/api/atlas/flower-demand-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, farmId: farm.id, idempotencyKey: key, ...body }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Flower demand could not be changed.");
      idempotency.current.delete(identity);
      setMessage(success);
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Flower demand could not be changed.");
    } finally {
      setSaving(null);
    }
  }

  async function commit(order: DemandOrder) {
    await runAction("commit", order.id, { demandOrderId: order.id }, `${order.customerLabel} is now committed demand. No Sale was created yet.`);
  }

  async function price(line: DemandLine) {
    const unitPrice = Number(priceDrafts[line.id] ?? line.targetUnitPrice ?? "");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) { setMessage("Enter a valid non-negative unit price."); return; }
    await runAction("price", line.id, {
      demandLineId: line.id,
      unitPrice,
      reasonKind: line.targetUnitPrice === null ? "price_set" : "price_revised",
    }, `${line.productLabel} price recorded at ${money(unitPrice)} per ${line.unit.replaceAll("_", " ")}.`);
  }

  async function reserve(line: DemandLine) {
    const matchingLots = (farm?.readyLots ?? []).filter((lot) => lotMatches(line, lot));
    const draft = allocationDrafts[line.id] ?? { readyLotId: matchingLots[0]?.id ?? "", quantity: String(Math.min(line.shortQuantity, matchingLots[0]?.availableQuantity ?? 0) || 1) };
    const quantity = Number(draft.quantity);
    if (!draft.readyLotId || !Number.isFinite(quantity) || quantity <= 0) { setMessage("Choose matching Ready inventory and a positive reservation quantity."); return; }
    await runAction("allocate", `${line.id}:${draft.readyLotId}`, { demandLineId: line.id, readyLotId: draft.readyLotId, quantity }, `${quantityLabel(quantity, line.unit, line.stemsPerUnit)} reserved for ${line.productLabel}.`);
  }

  async function release(allocation: Allocation, line: DemandLine) {
    await runAction("release", allocation.id, { allocationId: allocation.id, reasonKind: "manual_release" }, `Reservation released from ${line.productLabel}.`);
  }

  async function convert(order: DemandOrder) {
    await runAction("convert", order.id, { demandOrderId: order.id, taxAmount: 0, tipAmount: 0 }, `Sale recorded for ${order.customerLabel}. Existing fulfillment machinery now owns the handoff.`);
  }

  async function cancel(order: DemandOrder) {
    if (!window.confirm(`Cancel the flower demand for ${order.customerLabel}?`)) return;
    await runAction("cancel", order.id, { demandOrderId: order.id, reasonKind: "seller_cancelled" }, `Demand cancelled for ${order.customerLabel}.`);
  }

  return (
    <AtlasTaskCardFrame
      family="DEMAND"
      familyDetail="Commercial truth"
      title="Customer Demand"
      subtitle="Requests stay separate from inventory, Sale, fulfillment, and payment until each transition is explicitly recorded."
      timing={farm ? `${openOrders.length} active · ${closedOrders.length} closed` : "Loading demand"}
      completion={<span>Committed + priced + fully reserved demand can become a Sale. Demand alone never does.</span>}
    >
      <div className={styles.workspace} data-flower-demand-workflow="v1">
        {data?.farms && data.farms.length > 1 ? (
          <label className={styles.farmPicker}><span>Farm</span><select value={farm?.id ?? ""} onChange={(event) => setFarmId(event.target.value)}>{data.farms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        ) : null}

        {message ? <output className={styles.notice} aria-live="polite">{message}</output> : null}
        {loading && !data ? <p className={styles.empty}>Reading demand, reservations, and Ready inventory…</p> : null}

        {farm && !openOrders.length ? <div className={styles.empty}><b>No active customer demand.</b><span>Requests recorded elsewhere in Atlas will appear here without creating a Sale.</span></div> : null}

        <div className={styles.orders}>
          {openOrders.map((order) => (
            <article className={styles.order} key={order.id} data-state={order.lifecycleState}>
              <header className={styles.orderHeader}>
                <div><small>{order.effectiveDemandStrength.toUpperCase()} · {statusLabel(order).toUpperCase()}</small><h3>{order.customerLabel}</h3><p>{order.salesChannel.replaceAll("_", " ")} · needed {prettyDate(order.requestedForDate)} · {order.fulfillmentMode.replaceAll("_", " ")}</p></div>
                <div className={styles.headerActions}>
                  {order.effectiveDemandStrength === "requested" && !order.sale ? <button type="button" disabled={saving === `commit:${order.id}`} onClick={() => void commit(order)}>{saving === `commit:${order.id}` ? "Committing…" : "Commit order"}</button> : null}
                  {!order.sale ? <button type="button" className={styles.quietButton} disabled={Boolean(saving)} onClick={() => void cancel(order)}>Cancel</button> : null}
                </div>
              </header>

              <div className={styles.lines}>
                {order.lines.map((line) => {
                  const matchingLots = (farm.readyLots ?? []).filter((lot) => lotMatches(line, lot));
                  const draft = allocationDrafts[line.id] ?? { readyLotId: matchingLots[0]?.id ?? "", quantity: String(Math.min(line.shortQuantity, matchingLots[0]?.availableQuantity ?? 0) || 1) };
                  const activeAllocations = line.allocations.filter((allocation) => allocation.state === "active");
                  return (
                    <section className={styles.line} key={line.id}>
                      <div className={styles.lineSummary}>
                        <div><strong>{line.productLabel}</strong><span>{quantityLabel(line.quantity, line.unit, line.stemsPerUnit)}</span></div>
                        <div className={styles.lineFacts}>
                          <span><b>{money(line.targetUnitPrice)}</b> unit price</span>
                          <span><b>{quantityLabel(line.reservedQuantity, line.unit, line.stemsPerUnit)}</b> reserved</span>
                          <span><b>{quantityLabel(line.shortQuantity, line.unit, line.stemsPerUnit)}</b> short</span>
                        </div>
                      </div>

                      {!order.sale ? <div className={styles.controls}>
                        <label><span>Unit price</span><div className={styles.inlineControl}><input type="number" min="0" step=".01" placeholder={line.targetUnitPrice === null ? "0.00" : line.targetUnitPrice.toFixed(2)} value={priceDrafts[line.id] ?? ""} onChange={(event) => setPriceDrafts((current) => ({ ...current, [line.id]: event.target.value }))} /><button type="button" disabled={saving === `price:${line.id}`} onClick={() => void price(line)}>{saving === `price:${line.id}` ? "Saving…" : line.targetUnitPrice === null ? "Set price" : "Revise"}</button></div></label>

                        {line.shortQuantity > 0 ? <label><span>Reserve Ready inventory</span><div className={styles.reserveControl}>
                          <select value={draft.readyLotId} disabled={!matchingLots.length} onChange={(event) => setAllocationDrafts((current) => ({ ...current, [line.id]: { ...draft, readyLotId: event.target.value } }))}>
                            {!matchingLots.length ? <option value="">No matching Ready inventory</option> : matchingLots.map((lot) => <option key={lot.id} value={lot.id}>{lot.productLabel} · {quantityLabel(lot.availableQuantity, lot.unit, lot.stemsPerUnit)} available · {prettyDate(lot.readyDate)}</option>)}
                          </select>
                          <input type="number" min="0" step={line.unit === "bucket_equivalent" ? ".25" : "1"} value={draft.quantity} onChange={(event) => setAllocationDrafts((current) => ({ ...current, [line.id]: { ...draft, quantity: event.target.value } }))} />
                          <button type="button" disabled={!matchingLots.length || saving?.startsWith(`allocate:${line.id}:`)} onClick={() => void reserve(line)}>{saving?.startsWith(`allocate:${line.id}:`) ? "Reserving…" : "Reserve"}</button>
                        </div></label> : null}
                      </div> : null}

                      {activeAllocations.length ? <div className={styles.allocations}>{activeAllocations.map((allocation) => {
                        const lot = farm.readyLots.find((candidate) => candidate.id === allocation.readyLotId);
                        return <div key={allocation.id}><span>{quantityLabel(allocation.quantity, line.unit, line.stemsPerUnit)} reserved{lot ? ` from ${lot.productLabel}` : ""}</span><button type="button" className={styles.quietButton} disabled={saving === `release:${allocation.id}`} onClick={() => void release(allocation, line)}>{saving === `release:${allocation.id}` ? "Releasing…" : "Release"}</button></div>;
                      })}</div> : null}
                    </section>
                  );
                })}
              </div>

              <footer className={styles.orderFooter}>
                <div>
                  <span data-ready={order.effectiveDemandStrength === "committed"}>1. {order.effectiveDemandStrength === "committed" ? "Committed" : "Commitment needed"}</span>
                  <span data-ready={order.allPriced}>2. {order.allPriced ? "Priced" : "Pricing needed"}</span>
                  <span data-ready={order.allCovered}>3. {order.allCovered ? "Inventory reserved" : "Inventory short"}</span>
                </div>
                {order.lifecycleState === "covered" && order.effectiveDemandStrength === "committed" && order.allPriced && !order.sale ? <button type="button" className={styles.primaryButton} disabled={saving === `convert:${order.id}`} onClick={() => void convert(order)}>{saving === `convert:${order.id}` ? "Recording Sale…" : "Convert to Sale"}</button> : null}
                {order.sale ? <span className={styles.saleBadge}>Sale #{order.sale.saleOrderId.slice(0, 4).toUpperCase()} recorded</span> : null}
              </footer>
            </article>
          ))}
        </div>

        {closedOrders.length ? <details className={styles.history}><summary>Closed demand <span>{closedOrders.length}</span></summary><div>{closedOrders.map((order) => <article key={order.id}><b>{order.customerLabel}</b><span>{statusLabel(order)} · {prettyDate(order.requestedForDate)}</span></article>)}</div></details> : null}
      </div>
    </AtlasTaskCardFrame>
  );
}
