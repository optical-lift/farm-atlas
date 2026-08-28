"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import "./harvest-workbench.css";

type CropOption = { cropCycleId: string; cropProfileId: string | null; cropLabel: string; variety: string | null; objectLabel: string; objectKey: string | null };
type Product = { key: string; productLabel: string; inventoryKind: string; unit: string; stemsPerUnit: number | null; totalBorn: number; madeToday: number; claimed: number; out: number; disposed: number; availableNow: number; lotIds: string[] };
type AvailableLot = { id: string; productKey: string; productLabel: string; inventoryKind: string; quantity: number; unit: string; stemsPerUnit: number | null; readyDate: string; preparationBatchId: string; committedQuantity: number; disposedQuantity: number; availableQuantity: number };
type Activity = { id: string; at: string; date: string; kind: "harvest" | "ready" | "claim" | "handoff" | "release" | "removed"; direction: "in" | "out" | "neutral"; label: string; detail: string | null; quantity: number | null; unit: string | null; productKey: string | null; productLabel: string | null; harvestBatchId: string | null; preparationBatchId: string | null; readyLotId: string | null; orderId: string | null; taskId: string | null; source: string; actor: string };
type HarvestRun = { id: string; harvestDate: string; createdAt: string; taskId: string | null; actor: string; source: string; note: string | null; rows: Array<{ id: string; cropCycleId: string; cropLabel: string; variety: string | null; objectLabel: string; bucketEquivalent: number; bucketHalves: number | null; moreAvailability: string }> };
type PrepRun = { id: string; preparedDate: string; createdAt: string; harvestBatchId: string; taskId: string; actor: string; source: string; note: string | null; outputs: Array<{ id: string; productKey: string; productLabel: string; inventoryKind: string; quantity: number; unit: string; stemsPerUnit: number | null }> };
type GoingOut = { id: string; customerLabel: string; salesChannel: string; saleDate: string; fulfillmentMode: string; fulfillmentDueDate: string | null; fulfillmentDueTime: string | null; fulfillmentTaskId: string | null; fulfillmentTaskStatus: string | null; totalAmount: number; note: string | null; lines: Array<{ id: string; readyLotId: string; productKey: string; productLabel: string; quantity: number; unit: string }> };
type LedgerFarm = { id: string; key: string; name: string; cropOptions: CropOption[]; products: Product[]; availableLots: AvailableLot[]; todayActivity: Activity[]; activity: Activity[]; batches: { harvest: HarvestRun[]; preparation: PrepRun[] }; goingOut: GoingOut[]; counts: { availableProducts: number; madeToday: number; goingOut: number; activityToday: number } };
type LedgerResponse = { ok?: boolean; error?: string; asOf?: string; farms?: LedgerFarm[] };
type CommerceMember = { id: string; role: string; workerKey: string | null; displayName: string };
type CommerceFarm = { id: string; members: CommerceMember[] };
type CommerceResponse = { ok?: boolean; farms?: CommerceFarm[] };

type HarvestDraft = { id: string; cropCycleId: string; bucketHalves: number; moreAvailability: "yes" | "no" | "unsure" };
type PrepDraft = { id: string; productLabel: string; kind: "bundle" | "posy" | "bouquet" | "conditioned_bucket"; quantity: string; stemsPerUnit: string };
type SaleDraft = { id: string; readyLotId: string; quantity: string; unitPrice: string };
type LedgerTab = "available" | "today" | "activity" | "batches";

function localToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function prettyDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function prettyTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function amount(quantity: number, unit: string | null, stems: number | null = null) {
  const value = Number.isInteger(quantity) ? quantity.toFixed(0) : quantity.toFixed(2).replace(/0$/, "");
  if (unit === "bucket_equivalent") return `${value} bucket${quantity === 1 ? "" : "s"}`;
  if (unit === "bunch") return `${value} bunch${quantity === 1 ? "" : "es"}${stems ? ` × ${stems} stems` : ""}`;
  if (unit === "posy") return `${value} ${quantity === 1 ? "posy" : "posies"}`;
  if (unit === "bouquet") return `${value} bouquet${quantity === 1 ? "" : "s"}`;
  if (unit === "arrangement") return `${value} arrangement${quantity === 1 ? "" : "s"}`;
  if (unit === "stem") return `${value} stem${quantity === 1 ? "" : "s"}`;
  return `${value} ${(unit || "unit").replace(/_/g, " ")}`;
}
function halfBucketLabel(halves: number) {
  if (!halves) return "0";
  const whole = Math.floor(halves / 2);
  const half = halves % 2;
  if (!whole && half) return "½ bucket";
  if (whole === 1 && !half) return "1 bucket";
  return `${whole}${half ? "½" : ""} buckets`;
}
function productMeta(product: Pick<Product, "inventoryKind" | "stemsPerUnit">) {
  if (product.inventoryKind === "bunch" && product.stemsPerUnit) return `${product.stemsPerUnit}-stem bunch`;
  return product.inventoryKind.replace(/_/g, " ");
}
function sourceClass(source: string) { return source.startsWith("Task") ? "task" : source === "Harvest tab" ? "workbench" : "other"; }

export default function HarvestWorkbenchSection() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [commerce, setCommerce] = useState<CommerceResponse | null>(null);
  const [farmId, setFarmId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [tab, setTab] = useState<LedgerTab>("available");
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const ids = useRef(1);
  const harvestKey = useRef<string | null>(null);
  const prepKey = useRef<string | null>(null);
  const saleKey = useRef<string | null>(null);
  const handoffKeys = useRef(new Map<string, string>());

  const [harvestRows, setHarvestRows] = useState<HarvestDraft[]>([{ id: "harvest-1", cropCycleId: "", bucketHalves: 0, moreAvailability: "yes" }]);
  const [harvestNote, setHarvestNote] = useState("");
  const [harvestBatchId, setHarvestBatchId] = useState("");
  const [prepRows, setPrepRows] = useState<PrepDraft[]>([{ id: "prep-1", productLabel: "", kind: "bundle", quantity: "1", stemsPerUnit: "5" }]);
  const [prepNote, setPrepNote] = useState("");
  const [saleCustomer, setSaleCustomer] = useState("");
  const [saleChannel, setSaleChannel] = useState("wholesale");
  const [fulfillmentMode, setFulfillmentMode] = useState("delivery");
  const [dueDate, setDueDate] = useState(localToday());
  const [dueTime, setDueTime] = useState("");
  const [saleLines, setSaleLines] = useState<SaleDraft[]>([{ id: "sale-1", readyLotId: "", quantity: "1", unitPrice: "0" }]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [ledgerResponse, commerceResponse] = await Promise.all([
        fetch("/api/atlas/harvest-ledger", { cache: "no-store" }),
        fetch("/api/atlas/flower-commerce", { cache: "no-store" }),
      ]);
      const ledgerPayload = await ledgerResponse.json() as LedgerResponse;
      const commercePayload = await commerceResponse.json() as CommerceResponse;
      if (!ledgerResponse.ok || !ledgerPayload.ok) throw new Error(ledgerPayload.error || "Harvest ledger could not be loaded.");
      setData(ledgerPayload);
      setCommerce(commerceResponse.ok ? commercePayload : null);
      setFarmId((current) => current || ledgerPayload.farms?.[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Harvest workbench could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const farm = data?.farms?.find((candidate) => candidate.id === farmId) ?? data?.farms?.[0] ?? null;
  const commerceFarm = commerce?.farms?.find((candidate) => candidate.id === farm?.id) ?? null;
  const fulfillmentMember = commerceFarm?.members.find((member) => member.workerKey === "anna") ?? commerceFarm?.members[0] ?? null;

  useEffect(() => {
    if (!farm || harvestBatchId) return;
    const latest = [...farm.batches.harvest].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (latest) setHarvestBatchId(latest.id);
  }, [farm, harvestBatchId]);

  function nextId(prefix: string) { return `${prefix}-${++ids.current}`; }
  function resetHarvest() { setHarvestRows([{ id: nextId("harvest"), cropCycleId: "", bucketHalves: 0, moreAvailability: "yes" }]); setHarvestNote(""); harvestKey.current = null; }
  function resetPrep() { setPrepRows([{ id: nextId("prep"), productLabel: "", kind: "bundle", quantity: "1", stemsPerUnit: "5" }]); setPrepNote(""); prepKey.current = null; }
  function resetSale() { setSaleCustomer(""); setSaleLines([{ id: nextId("sale"), readyLotId: "", quantity: "1", unitPrice: "0" }]); saleKey.current = null; }

  async function submitHarvest() {
    if (!farm) return;
    const valid = harvestRows.filter((row) => row.cropCycleId && row.bucketHalves > 0);
    if (!valid.length) { setMessage("Choose a crop and record how much was cut."); return; }
    const key = harvestKey.current ?? `harvest-workbench:${crypto.randomUUID()}`;
    harvestKey.current = key;
    try {
      setSaving("harvest"); setMessage(null);
      const response = await fetch("/api/atlas/harvest-workbench", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ action: "harvest", farmId: farm.id, rows: valid, note: harvestNote.trim() || null, idempotencyKey: key }) });
      const payload = await response.json() as { ok?: boolean; error?: string; harvestBatchId?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Harvest could not be recorded.");
      setMessage("Harvest logged. It is already part of the same Harvest history as scheduled task results.");
      resetHarvest();
      if (payload.harvestBatchId) setHarvestBatchId(payload.harvestBatchId);
      await load();
    } catch (saveError) { setMessage(saveError instanceof Error ? saveError.message : "Harvest could not be recorded."); }
    finally { setSaving(null); }
  }

  async function submitPrep() {
    if (!farm || !harvestBatchId) { setMessage("Choose which harvest batch these flowers came from."); return; }
    const outputs = prepRows.map((row) => ({ kind: row.kind, productLabel: row.productLabel.trim(), quantity: Number(row.quantity), stemsPerUnit: row.kind === "bundle" ? Number(row.stemsPerUnit) : null }));
    if (outputs.some((row) => !row.productLabel || !Number.isFinite(row.quantity) || row.quantity <= 0 || (row.kind === "bundle" && (!Number.isInteger(row.stemsPerUnit) || Number(row.stemsPerUnit) < 1)))) {
      setMessage("Each finished line needs its flower, quantity, and stems per bunch when it is a bunch."); return;
    }
    const key = prepKey.current ?? `flower-prep-workbench:${crypto.randomUUID()}`;
    prepKey.current = key;
    try {
      setSaving("prepare"); setMessage(null);
      const response = await fetch("/api/atlas/harvest-workbench", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ action: "prepare", farmId: farm.id, harvestBatchId, outputs, note: prepNote.trim() || null, idempotencyKey: key }) });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Finished flowers could not be recorded.");
      setMessage("Finished flowers added to Ready. This is a separate prep run, while the inventory total accumulates.");
      resetPrep();
      await load();
    } catch (saveError) { setMessage(saveError instanceof Error ? saveError.message : "Finished flowers could not be recorded."); }
    finally { setSaving(null); }
  }

  const validSale = Boolean(farm && saleCustomer.trim() && saleLines.length && saleLines.every((line) => {
    const lot = farm.availableLots.find((candidate) => candidate.id === line.readyLotId);
    const quantity = Number(line.quantity); const price = Number(line.unitPrice);
    return lot && Number.isFinite(quantity) && quantity > 0 && quantity <= lot.availableQuantity && Number.isFinite(price) && price >= 0;
  }) && (fulfillmentMode === "immediate_handoff" || (dueDate && fulfillmentMember)));

  async function submitSale() {
    if (!farm || !validSale) { setMessage("Choose the exact Ready flowers, customer, and handoff plan."); return; }
    const key = saleKey.current ?? `harvest-workbench-sale:${crypto.randomUUID()}`;
    saleKey.current = key;
    try {
      setSaving("sale"); setMessage(null);
      const response = await fetch("/api/atlas/flower-commerce", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({
        farmId: farm.id, buyerRelationshipId: null, customerLabel: saleCustomer.trim(), salesChannel: saleChannel,
        lines: saleLines.map((line) => ({ readyLotId: line.readyLotId, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) })),
        taxAmount: 0, tipAmount: 0, fulfillmentMode,
        fulfillmentDueDate: fulfillmentMode === "immediate_handoff" ? null : dueDate,
        fulfillmentDueTime: fulfillmentMode === "immediate_handoff" ? null : (dueTime || null),
        fulfillmentMembershipId: fulfillmentMode === "immediate_handoff" ? null : fulfillmentMember?.id,
        note: null, idempotencyKey: key,
      }) });
      const payload = await response.json() as { ok?: boolean; error?: string; fulfilled?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Flowers could not be claimed.");
      setMessage(payload.fulfilled ? "Sale and handoff recorded." : "Flowers claimed. They are now waiting in Handoff instead of Available.");
      resetSale();
      await load();
    } catch (saveError) { setMessage(saveError instanceof Error ? saveError.message : "Flowers could not be claimed."); }
    finally { setSaving(null); }
  }

  async function completeHandoff(order: GoingOut) {
    if (!order.fulfillmentTaskId) { setMessage("Atlas has not attached the handoff task to this order yet."); return; }
    const key = handoffKeys.current.get(order.id) ?? `harvest-workbench-handoff:${order.id}:${crypto.randomUUID()}`;
    handoffKeys.current.set(order.id, key);
    try {
      setSaving(`handoff:${order.id}`); setMessage(null);
      const response = await fetch("/api/atlas/flower-fulfillment", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ taskId: order.fulfillmentTaskId, idempotencyKey: key, note: null }) });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Handoff could not be recorded.");
      handoffKeys.current.delete(order.id);
      setMessage(`${order.customerLabel} is recorded as handed off.`);
      await load();
    } catch (saveError) { setMessage(saveError instanceof Error ? saveError.message : "Handoff could not be recorded."); }
    finally { setSaving(null); }
  }

  const productActivity = useMemo(() => farm && expandedProduct ? farm.activity.filter((activity) => activity.productKey === expandedProduct) : [], [farm, expandedProduct]);
  const combinedBatches = useMemo(() => {
    if (!farm) return [];
    return [
      ...farm.batches.harvest.map((batch) => ({ type: "harvest" as const, id: batch.id, at: batch.createdAt, batch })),
      ...farm.batches.preparation.map((batch) => ({ type: "prepare" as const, id: batch.id, at: batch.createdAt, batch })),
    ].sort((a, b) => b.at.localeCompare(a.at));
  }, [farm]);

  return (
    <section className="harvest-workbench" data-harvest-workbench="permanent-task-cards">
      <header className="harvest-workbench__intro">
        <div><span>HARVEST WORKBENCH</span><h1>Do the work here. See the inventory below.</h1><p>The same flower history collects scheduled task results and anything logged directly from Harvest.</p></div>
        {(data?.farms?.length ?? 0) > 1 ? <select value={farm?.id || ""} onChange={(event) => setFarmId(event.target.value)}>{data?.farms?.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select> : null}
      </header>

      {error ? <div className="harvest-workbench__notice harvest-workbench__notice--error"><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div> : null}
      {message ? <div className="harvest-workbench__notice"><span>{message}</span><button type="button" onClick={() => setMessage(null)}>×</button></div> : null}
      {loading && !data ? <div className="harvest-workbench__loading">Loading the shared flower history…</div> : null}

      {farm ? <div className="harvest-workbench__cards">
        <AtlasTaskCardFrame family="HARVEST" familyDetail="Permanent card" title="Harvest Stems" subtitle="Log another cut any time." timing="Same controls, same physical harvest history." completion={<button type="button" className="harvest-workbench__primary" disabled={saving === "harvest"} onClick={() => void submitHarvest()}>{saving === "harvest" ? "Logging…" : "Log harvest"}</button>}>
          <div className="harvest-workbench__task-body">
            {harvestRows.map((row, index) => {
              const crop = farm.cropOptions.find((option) => option.cropCycleId === row.cropCycleId);
              return <div className="harvest-workbench__harvest-row" key={row.id}>
                <label><span>{index === 0 ? "What did you cut?" : "Another crop"}</span><select value={row.cropCycleId} onChange={(event) => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, cropCycleId: event.target.value } : item)); }}><option value="">Choose crop + bed</option>{farm.cropOptions.map((option) => <option key={option.cropCycleId} value={option.cropCycleId}>{option.objectLabel} · {option.cropLabel}{option.variety ? ` · ${option.variety}` : ""}</option>)}</select></label>
                {crop ? <small>{crop.objectLabel} · {crop.cropLabel}{crop.variety ? ` · ${crop.variety}` : ""}</small> : null}
                <div className="harvest-workbench__counter"><button type="button" onClick={() => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, bucketHalves: Math.max(0, item.bucketHalves - 1) } : item)); }}>−</button><strong>{halfBucketLabel(row.bucketHalves)}</strong><button type="button" onClick={() => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, bucketHalves: Math.min(40, item.bucketHalves + 1) } : item)); }}>+</button></div>
                <div className="harvest-workbench__choice"><span>More still out there?</span>{(["yes", "unsure", "no"] as const).map((value) => <button type="button" key={value} data-selected={row.moreAvailability === value ? "true" : "false"} onClick={() => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, moreAvailability: value } : item)); }}>{value === "yes" ? "Yes" : value === "no" ? "No" : "Not sure"}</button>)}</div>
                {harvestRows.length > 1 ? <button type="button" className="harvest-workbench__text-button" onClick={() => setHarvestRows((current) => current.filter((item) => item.id !== row.id))}>Remove row</button> : null}
              </div>;
            })}
            <button type="button" className="harvest-workbench__add" onClick={() => setHarvestRows((current) => [...current, { id: nextId("harvest"), cropCycleId: "", bucketHalves: 0, moreAvailability: "yes" }])}>+ Add another crop</button>
            <label className="harvest-workbench__note"><span>Field note <small>optional</small></span><input value={harvestNote} onChange={(event) => { harvestKey.current = null; setHarvestNote(event.target.value); }} placeholder="Anything useful about this cut" /></label>
          </div>
        </AtlasTaskCardFrame>

        <AtlasTaskCardFrame family="POST-HARVEST" familyDetail="Permanent card" title="Condition + Bunch" subtitle="Log another finished batch whenever Anna makes more." timing="Each use stays separate; Ready totals accumulate." completion={<button type="button" className="harvest-workbench__primary" disabled={saving === "prepare"} onClick={() => void submitPrep()}>{saving === "prepare" ? "Recording…" : "Add finished flowers"}</button>}>
          <div className="harvest-workbench__task-body">
            <label><span>Which harvest did these come from?</span><select value={harvestBatchId} onChange={(event) => { prepKey.current = null; setHarvestBatchId(event.target.value); }}><option value="">Choose harvest batch</option>{farm.batches.harvest.map((batch) => <option key={batch.id} value={batch.id}>{prettyDate(batch.harvestDate)} · {batch.rows.map((row) => row.cropLabel).filter((value, index, array) => array.indexOf(value) === index).join(" + ") || "Harvest"} · {batch.actor}</option>)}</select></label>
            <div className="harvest-workbench__prep-lines">{prepRows.map((row, index) => <div className="harvest-workbench__prep-line" key={row.id}>
              <span className="harvest-workbench__line-number">{index + 1}</span>
              <input aria-label="Flower or product" placeholder="Sunflower" value={row.productLabel} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, productLabel: event.target.value } : item)); }} />
              <select aria-label="Finished form" value={row.kind} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, kind: event.target.value as PrepDraft["kind"] } : item)); }}><option value="bundle">Bunch</option><option value="posy">Posy</option><option value="bouquet">Bouquet</option><option value="conditioned_bucket">DIY / conditioned bucket</option></select>
              <input aria-label="Quantity made" type="number" min="0" step={row.kind === "conditioned_bucket" ? "0.25" : "1"} value={row.quantity} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, quantity: event.target.value } : item)); }} />
              {row.kind === "bundle" ? <label className="harvest-workbench__stems"><input aria-label="Stems per bunch" type="number" min="1" value={row.stemsPerUnit} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, stemsPerUnit: event.target.value } : item)); }} /><span>stems each</span></label> : null}
              {prepRows.length > 1 ? <button type="button" className="harvest-workbench__remove" onClick={() => setPrepRows((current) => current.filter((item) => item.id !== row.id))}>×</button> : null}
            </div>)}</div>
            <button type="button" className="harvest-workbench__add" onClick={() => setPrepRows((current) => [...current, { id: nextId("prep"), productLabel: "", kind: "bundle", quantity: "1", stemsPerUnit: "5" }])}>+ Add another finished item</button>
            <label className="harvest-workbench__note"><span>Prep note <small>optional</small></span><input value={prepNote} onChange={(event) => { prepKey.current = null; setPrepNote(event.target.value); }} placeholder="Anything about this batch" /></label>
          </div>
        </AtlasTaskCardFrame>

        <AtlasTaskCardFrame family="SALES" familyDetail="Permanent card" title="Sell / Claim" subtitle="Attach the exact Ready flowers to a buyer, pickup, or delivery." timing={`${farm.availableLots.length} Ready lot${farm.availableLots.length === 1 ? "" : "s"} currently available.`} completion={<button type="button" className="harvest-workbench__primary" disabled={saving === "sale" || !validSale} onClick={() => void submitSale()}>{saving === "sale" ? "Claiming…" : "Claim these flowers"}</button>}>
          <div className="harvest-workbench__task-body">
            <label><span>Customer / destination</span><input value={saleCustomer} onChange={(event) => { saleKey.current = null; setSaleCustomer(event.target.value); }} placeholder="Florist, pickup customer, event…" /></label>
            <div className="harvest-workbench__sale-settings"><label><span>Channel</span><select value={saleChannel} onChange={(event) => { saleKey.current = null; setSaleChannel(event.target.value); }}><option value="wholesale">Wholesale</option><option value="farm_pickup">Farm pickup</option><option value="delivery">Delivery</option><option value="market">Market</option><option value="event">Event</option><option value="other">Other</option></select></label><label><span>Handoff</span><select value={fulfillmentMode} onChange={(event) => { saleKey.current = null; setFulfillmentMode(event.target.value); }}><option value="delivery">Delivery later</option><option value="pickup">Pickup later</option><option value="immediate_handoff">Handing over now</option></select></label></div>
            {fulfillmentMode !== "immediate_handoff" ? <div className="harvest-workbench__sale-settings"><label><span>Date</span><input type="date" value={dueDate} onChange={(event) => { saleKey.current = null; setDueDate(event.target.value); }} /></label><label><span>Time <small>optional</small></span><input type="time" value={dueTime} onChange={(event) => { saleKey.current = null; setDueTime(event.target.value); }} /></label></div> : null}
            <div className="harvest-workbench__sale-lines">{saleLines.map((line, index) => { const lot = farm.availableLots.find((candidate) => candidate.id === line.readyLotId); return <div className="harvest-workbench__sale-line" key={line.id}><span className="harvest-workbench__line-number">{index + 1}</span><select aria-label="Ready flowers" value={line.readyLotId} onChange={(event) => { saleKey.current = null; setSaleLines((current) => current.map((item) => item.id === line.id ? { ...item, readyLotId: event.target.value } : item)); }}><option value="">Choose Ready flowers</option>{farm.availableLots.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.productLabel} · {amount(candidate.availableQuantity, candidate.unit, candidate.stemsPerUnit)} available</option>)}</select><input aria-label="Quantity claimed" type="number" min="0" max={lot?.availableQuantity} step={lot?.inventoryKind === "conditioned_bucket" ? "0.25" : "1"} value={line.quantity} onChange={(event) => { saleKey.current = null; setSaleLines((current) => current.map((item) => item.id === line.id ? { ...item, quantity: event.target.value } : item)); }} /><label className="harvest-workbench__price"><span>$</span><input aria-label="Unit price" type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => { saleKey.current = null; setSaleLines((current) => current.map((item) => item.id === line.id ? { ...item, unitPrice: event.target.value } : item)); }} /></label>{saleLines.length > 1 ? <button type="button" className="harvest-workbench__remove" onClick={() => setSaleLines((current) => current.filter((item) => item.id !== line.id))}>×</button> : null}</div>; })}</div>
            <button type="button" className="harvest-workbench__add" onClick={() => setSaleLines((current) => [...current, { id: nextId("sale"), readyLotId: "", quantity: "1", unitPrice: "0" }])}>+ Add another Ready item</button>
          </div>
        </AtlasTaskCardFrame>

        <AtlasTaskCardFrame family="FULFILLMENT" familyDetail="Permanent card" title="Handoff" subtitle="Everything currently claimed and waiting to leave Elm." timing={`${farm.goingOut.length} handoff${farm.goingOut.length === 1 ? "" : "s"} waiting.`} completion={<span className="harvest-workbench__completion-copy">Each order closes when its flowers actually leave.</span>}>
          <div className="harvest-workbench__task-body harvest-workbench__handoffs">
            {!farm.goingOut.length ? <div className="harvest-workbench__empty"><b>Nothing is waiting for handoff.</b><span>New pickups and deliveries appear here as soon as Ready flowers are claimed.</span></div> : farm.goingOut.map((order) => <article key={order.id} className="harvest-workbench__handoff"><div><small>{order.fulfillmentMode === "pickup" ? "Pickup" : "Delivery"}{order.fulfillmentDueDate ? ` · ${prettyDate(order.fulfillmentDueDate)}` : ""}{order.fulfillmentDueTime ? ` · ${order.fulfillmentDueTime.slice(0, 5)}` : ""}</small><h3>{order.customerLabel}</h3><p>{order.lines.map((line) => `${amount(line.quantity, line.unit)} ${line.productLabel}`).join(" · ")}</p></div><button type="button" disabled={!order.fulfillmentTaskId || saving === `handoff:${order.id}`} onClick={() => void completeHandoff(order)}>{saving === `handoff:${order.id}` ? "Saving…" : "Handed off"}</button></article>)}
          </div>
        </AtlasTaskCardFrame>
      </div> : null}

      {farm ? <section className="harvest-ledger" aria-labelledby="harvest-ledger-title">
        <header className="harvest-ledger__header"><div><span>LIVE FLOWER LEDGER</span><h2 id="harvest-ledger-title">What exists, what moved, and where it went.</h2><p>Task results and Harvest-tab entries are accumulated here without losing their individual runs.</p></div><div className="harvest-ledger__counts"><div><strong>{farm.counts.availableProducts}</strong><span>available products</span></div><div><strong>{farm.counts.goingOut}</strong><span>waiting to leave</span></div></div></header>
        <nav className="harvest-ledger__tabs" aria-label="Harvest ledger views">{([['available','AVAILABLE NOW'],['today','TODAY'],['activity','ACTIVITY'],['batches','BATCHES']] as Array<[LedgerTab,string]>).map(([value,label]) => <button type="button" key={value} data-active={tab === value ? "true" : "false"} onClick={() => setTab(value)}>{label}</button>)}</nav>

        {tab === "available" ? <div className="harvest-ledger__panel"><div className="harvest-ledger__table harvest-ledger__table--products"><div className="harvest-ledger__table-head"><span>Ready product</span><span>Made today</span><span>Claimed</span><span>Out</span><span>Available now</span></div>{farm.products.map((product) => <div key={product.key} className="harvest-ledger__product-wrap"><button type="button" className="harvest-ledger__product" onClick={() => setExpandedProduct((current) => current === product.key ? null : product.key)}><span><b>{product.productLabel}</b><small>{productMeta(product)}</small></span><span>{amount(product.madeToday, product.unit)}</span><span>{amount(product.claimed, product.unit)}</span><span>{amount(product.out, product.unit)}</span><strong>{amount(product.availableNow, product.unit)}</strong></button>{expandedProduct === product.key ? <div className="harvest-ledger__genealogy"><header><b>{product.productLabel} history</b><span>{product.totalBorn} made in recorded Ready lots</span></header>{productActivity.length ? productActivity.map((activity) => <ActivityRow activity={activity} key={activity.id} />) : <span>No product activity in this history window.</span>}</div> : null}</div>)}{!farm.products.length ? <div className="harvest-ledger__empty-row">No finished flower inventory has been recorded yet.</div> : null}</div></div> : null}

        {tab === "today" ? <div className="harvest-ledger__panel"><div className="harvest-ledger__today-summary"><div><strong>{farm.products.reduce((sum, product) => sum + product.madeToday, 0)}</strong><span>finished units made today</span></div><div><strong>{farm.todayActivity.filter((item) => item.kind === "harvest").length}</strong><span>harvest entries today</span></div><div><strong>{farm.todayActivity.filter((item) => item.kind === "claim").length}</strong><span>claim entries today</span></div></div><div className="harvest-ledger__activity">{farm.todayActivity.length ? farm.todayActivity.map((activity) => <ActivityRow activity={activity} key={activity.id} />) : <div className="harvest-ledger__empty-row">Nothing has been logged today yet.</div>}</div></div> : null}

        {tab === "activity" ? <div className="harvest-ledger__panel"><div className="harvest-ledger__activity">{farm.activity.length ? farm.activity.map((activity) => <ActivityRow activity={activity} key={activity.id} />) : <div className="harvest-ledger__empty-row">No flower activity in this history window.</div>}</div></div> : null}

        {tab === "batches" ? <div className="harvest-ledger__panel harvest-ledger__batches">{combinedBatches.length ? combinedBatches.map((item) => item.type === "harvest" ? <article className="harvest-ledger__batch" key={`h:${item.id}`}><header><div><span>HARVEST RUN</span><h3>{prettyDate(item.batch.harvestDate)} · {prettyTime(item.batch.createdAt)}</h3></div><SourceBadge source={item.batch.source} actor={item.batch.actor} /></header><div>{item.batch.rows.map((row) => <p key={row.id}><b>{row.cropLabel}{row.variety ? ` · ${row.variety}` : ""}</b><span>{row.objectLabel}</span><strong>{amount(row.bucketEquivalent, "bucket_equivalent")}</strong></p>)}</div>{item.batch.note ? <small>{item.batch.note}</small> : null}</article> : <article className="harvest-ledger__batch" key={`p:${item.id}`}><header><div><span>PREP RUN</span><h3>{prettyDate(item.batch.preparedDate)} · {prettyTime(item.batch.createdAt)}</h3></div><SourceBadge source={item.batch.source} actor={item.batch.actor} /></header><div>{item.batch.outputs.map((output) => <p key={output.id}><b>{output.productLabel}</b><span>{output.inventoryKind === "bunch" && output.stemsPerUnit ? `${output.stemsPerUnit} stems each` : output.inventoryKind.replace(/_/g, " ")}</span><strong>{amount(output.quantity, output.unit)}</strong></p>)}</div>{item.batch.note ? <small>{item.batch.note}</small> : null}</article>) : <div className="harvest-ledger__empty-row">No harvest or prep batches in this history window.</div>}</div> : null}
      </section> : null}
    </section>
  );
}

function SourceBadge({ source, actor }: { source: string; actor: string }) {
  return <span className="harvest-ledger__source" data-source={sourceClass(source)}>{source}<small>{actor}</small></span>;
}

function ActivityRow({ activity }: { activity: Activity }) {
  const sign = activity.kind === "release" || activity.kind === "ready" ? "+" : activity.kind === "claim" || activity.kind === "handoff" || activity.kind === "removed" ? "−" : "";
  const kindLabel: Record<Activity["kind"], string> = { harvest: "Harvested", ready: "Made Ready", claim: "Claimed", handoff: "Handed off", release: "Claim released", removed: "Removed" };
  return <article className="harvest-ledger__activity-row" data-kind={activity.kind}><time><b>{prettyDate(activity.date)}</b><span>{prettyTime(activity.at)}</span></time><div><small>{kindLabel[activity.kind]}</small><h3>{activity.label}</h3>{activity.detail ? <p>{activity.detail}</p> : null}</div>{activity.quantity !== null && activity.unit ? <strong>{sign}{amount(activity.quantity, activity.unit)}</strong> : null}<SourceBadge source={activity.source} actor={activity.actor} /></article>;
}
