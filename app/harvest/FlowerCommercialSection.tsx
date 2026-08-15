"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AtlasCard, AtlasSectionHeading } from "@/components/atlas/ui/AtlasPrimitives";
import "./commerce.css";

type AvailableLot = { id: string; inventoryKind: string; unit: string; quantityExactness: string; readyDate: string; birthQuantity: number; committedQuantity: number; availableQuantity: number };
type OrderLine = { id: string; readyLotId: string; inventoryKind: string; quantity: number; unit: string; unitPrice: number; lineTotal: number };
type Order = { id: string; customerLabel: string; salesChannel: string; eventKey: string | null; saleDate: string; fulfillmentMode: string; fulfillmentDueDate: string | null; fulfillmentDueTime: string | null; totalAmount: number; lines: OrderLine[]; fulfillment: { id: string; fulfilledAt: string; method: string } | null };
type Buyer = { id: string; businessName: string; buyerType: string | null; relationshipStatus: string | null; priorityRank: number | null };
type Member = { id: string; role: string; workerKey: string | null; displayName: string };
type Farm = { id: string; key: string; name: string; available: AvailableLot[]; goingOut: Order[]; fulfilled: Order[]; buyers: Buyer[]; members: Member[] };
type Response = { ok?: boolean; error?: string; farms?: Farm[] };
type DraftLine = { id: string; readyLotId: string; quantity: string; unitPrice: string };

const KIND_LABELS: Record<string, string> = { conditioned_bucket: "Conditioned flowers", counted_stems: "Counted stems", posy: "Posy", bouquet: "Bouquet", lobby_arrangement: "Lobby arrangement" };
const CHANNELS = [["wholesale", "Wholesale"], ["farm_pickup", "Farm pickup"], ["delivery", "Delivery"], ["market", "Market"], ["subscription", "Subscription"], ["event", "Event"], ["other", "Other"]] as const;

function prettyDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function prettyDateTime(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function amount(quantity: number, unit: string, lowerBound = false) {
  const value = Number.isInteger(quantity) ? quantity.toFixed(0) : quantity.toFixed(2).replace(/0$/, "");
  const noun = unit === "bucket_equivalent" ? (quantity === 1 && !lowerBound ? "bucket" : "buckets") : unit.replace(/_/g, " ");
  return `${lowerBound ? "≥" : ""}${value} ${noun}`;
}

export default function FlowerCommercialSection() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [farmId, setFarmId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [salesChannel, setSalesChannel] = useState("market");
  const [eventKey, setEventKey] = useState("");
  const [tax, setTax] = useState("0");
  const [tip, setTip] = useState("0");
  const [fulfillmentMode, setFulfillmentMode] = useState("immediate_handoff");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [fulfillmentMembershipId, setFulfillmentMembershipId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ id: "sale-line-1", readyLotId: "", quantity: "", unitPrice: "" }]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const nextLineId = useRef(2);
  const pendingSaleKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/atlas/flower-commerce", { cache: "no-store" });
      const payload = await response.json() as Response;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Flower commercial truth could not be loaded.");
      setData(payload);
      setFarmId((current) => current || payload.farms?.[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Flower commercial truth could not be loaded.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const farm = data?.farms?.find((candidate) => candidate.id === farmId) ?? data?.farms?.[0] ?? null;
  const selectedBuyer = farm?.buyers.find((buyer) => buyer.id === buyerId) ?? null;
  useEffect(() => {
    if (!farm) return;
    if (fulfillmentMembershipId && farm.members.some((member) => member.id === fulfillmentMembershipId)) return;
    setFulfillmentMembershipId(farm.members[0]?.id || "");
  }, [farm, fulfillmentMembershipId]);

  const subtotal = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    return sum + (Number.isFinite(quantity) && Number.isFinite(unitPrice) ? quantity * unitPrice : 0);
  }, 0), [lines]);

  function resetDraftLines() {
    setLines([{ id: `sale-line-${nextLineId.current++}`, readyLotId: "", quantity: "", unitPrice: "" }]);
    pendingSaleKey.current = null;
  }
  function updateLine(id: string, patch: Partial<DraftLine>) { setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line)); pendingSaleKey.current = null; }
  function addLine() { setLines((current) => [...current, { id: `sale-line-${nextLineId.current++}`, readyLotId: "", quantity: "", unitPrice: "" }]); pendingSaleKey.current = null; }
  function removeLine(id: string) { setLines((current) => current.filter((line) => line.id !== id)); pendingSaleKey.current = null; }

  async function submitSale() {
    if (!farm) return;
    const idempotencyKey = pendingSaleKey.current ?? `flower-sale:${farm.id}:${crypto.randomUUID()}`;
    pendingSaleKey.current = idempotencyKey;
    try {
      setSaving(true);
      setMessage(null);
      const normalizedLines = lines.map((line) => ({ readyLotId: line.readyLotId, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }));
      const response = await fetch("/api/atlas/flower-commerce", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          farmId: farm.id,
          buyerRelationshipId: buyerId || null,
          customerLabel: customerLabel.trim() || selectedBuyer?.businessName || null,
          salesChannel,
          eventKey: eventKey.trim() || null,
          lines: normalizedLines,
          taxAmount: Number(tax || 0),
          tipAmount: Number(tip || 0),
          fulfillmentMode,
          fulfillmentDueDate: fulfillmentMode === "immediate_handoff" ? null : dueDate,
          fulfillmentDueTime: fulfillmentMode === "immediate_handoff" ? null : (dueTime || null),
          fulfillmentMembershipId: fulfillmentMode === "immediate_handoff" ? null : fulfillmentMembershipId,
          note: note.trim() || null,
          idempotencyKey,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; fulfilled?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Flower sale could not be recorded.");
      setMessage(payload.fulfilled ? "Sale and immediate handoff recorded." : "Sale recorded. The committed pickup/delivery is now Going out.");
      resetDraftLines();
      setBuyerId(""); setCustomerLabel(""); setEventKey(""); setTax("0"); setTip("0"); setNote("");
      await load();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "Flower sale could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  const hasAvailable = (data?.farms ?? []).some((candidate) => candidate.available.length);
  const hasGoingOut = (data?.farms ?? []).some((candidate) => candidate.goingOut.length);
  const hasFulfilled = (data?.farms ?? []).some((candidate) => candidate.fulfilled.length);
  const selectedLotIds = lines.map((line) => line.readyLotId).filter(Boolean);
  const distinctLots = new Set(selectedLotIds).size === selectedLotIds.length;
  const validLines = Boolean(farm && lines.length > 0 && distinctLots && lines.every((line) => {
    const lot = farm.available.find((candidate) => candidate.id === line.readyLotId);
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    return lot && Number.isFinite(quantity) && quantity > 0 && quantity <= lot.availableQuantity && Number.isFinite(unitPrice) && unitPrice >= 0;
  }));
  const canSubmit = Boolean(farm && validLines && (fulfillmentMode === "immediate_handoff" || (dueDate && fulfillmentMembershipId)));

  return <>
    <AtlasCard as="section" className="atlas-commerce" ariaLabelledBy="atlas-available-title">
      <header className="atlas-commerce__heading"><div><AtlasSectionHeading kicker="Unclaimed Ready inventory" title="Available" id="atlas-available-title" /><p>Available is derived from Ready birth quantity minus explicit sale claims. Ready history itself is never rewritten.</p></div></header>
      {error ? <div className="atlas-commerce__state atlas-commerce__state--error"><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div> : null}
      {data && !hasAvailable ? <div className="atlas-commerce__empty"><b>No unclaimed Ready flower inventory.</b><span>Prepared output appears here only while a known Ready quantity remains unclaimed.</span></div> : null}
      {(data?.farms ?? []).filter((candidate) => candidate.available.length).map((candidate) => <section className="atlas-commerce__farm" key={candidate.id}><header><small>Available at</small><h3>{candidate.name}</h3></header><div className="atlas-commerce__list">{candidate.available.map((lot) => <article className="atlas-commerce-item" key={lot.id}><div><small>Ready {prettyDate(lot.readyDate)}</small><h4>{KIND_LABELS[lot.inventoryKind] ?? lot.inventoryKind}</h4><p>{amount(lot.committedQuantity, lot.unit)} already committed from {amount(lot.birthQuantity, lot.unit, lot.quantityExactness === "lower_bound")}</p></div><strong>{amount(lot.availableQuantity, lot.unit, lot.quantityExactness === "lower_bound")}</strong></article>)}</div></section>)}
    </AtlasCard>

    <AtlasCard as="section" className="atlas-commerce" ariaLabelledBy="atlas-sale-title">
      <header className="atlas-commerce__heading"><div><AtlasSectionHeading kicker="Commercial commitment" title="Record sale" id="atlas-sale-title" /><p>A sale must claim specific Ready inventory. Buyer outreach, quoted quantity, or a task note is not a sale.</p></div></header>
      {!farm || !farm.available.length ? <div className="atlas-commerce__empty"><b>No Available inventory can be sold from this surface right now.</b><span>Ready inventory must exist and remain unclaimed before Atlas can create a commercial commitment.</span></div> : <div className="atlas-commerce-form">
        {(data?.farms?.length ?? 0) > 1 ? <label><span>Farm</span><select value={farm.id} onChange={(event) => { setFarmId(event.target.value); setBuyerId(""); resetDraftLines(); }}>{data?.farms?.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label> : null}
        <div className="atlas-commerce-form__grid">
          <label><span>Known buyer (optional)</span><select value={buyerId} onChange={(event) => { setBuyerId(event.target.value); pendingSaleKey.current = null; }}><option value="">Walk-up / other</option>{farm.buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.businessName}</option>)}</select></label>
          <label><span>Customer label (optional)</span><input value={customerLabel} onChange={(event) => { setCustomerLabel(event.target.value); pendingSaleKey.current = null; }} placeholder={selectedBuyer?.businessName || "Name for this order"} /></label>
          <label><span>Sales channel</span><select value={salesChannel} onChange={(event) => { setSalesChannel(event.target.value); pendingSaleKey.current = null; }}>{CHANNELS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label><span>Event / sale key (optional)</span><input value={eventKey} onChange={(event) => { setEventKey(event.target.value); pendingSaleKey.current = null; }} placeholder="lobelia_farmers_market_2026" /></label>
        </div>
        <div className="atlas-commerce-lines">{lines.map((line, index) => { const lot = farm.available.find((candidate) => candidate.id === line.readyLotId); return <div className="atlas-commerce-line" key={line.id}>
          <label><span>Ready inventory {index + 1}</span><select value={line.readyLotId} onChange={(event) => updateLine(line.id, { readyLotId: event.target.value, quantity: "" })}><option value="">Choose Ready lot</option>{farm.available.map((candidate) => <option key={candidate.id} value={candidate.id}>{KIND_LABELS[candidate.inventoryKind] ?? candidate.inventoryKind} · {amount(candidate.availableQuantity, candidate.unit, candidate.quantityExactness === "lower_bound")} available</option>)}</select></label>
          <label><span>Quantity{lot ? ` · max ${amount(lot.availableQuantity, lot.unit)}` : ""}</span><input type="number" min={lot?.unit === "bucket_equivalent" ? "0.25" : "1"} step={lot?.unit === "bucket_equivalent" ? "0.25" : "1"} value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} /></label>
          <label><span>Unit price</span><input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })} placeholder="0.00" /></label>
          {lines.length > 1 ? <button type="button" className="atlas-commerce__secondary" onClick={() => removeLine(line.id)}>Remove</button> : null}
        </div>; })}<button type="button" className="atlas-commerce__secondary" onClick={addLine}>+ Add another Ready lot</button></div>
        {!distinctLots ? <p className="atlas-commerce__message">Choose each Ready lot only once in this sale.</p> : null}
        <div className="atlas-commerce-form__grid">
          <label><span>Tax</span><input type="number" min="0" step="0.01" value={tax} onChange={(event) => { setTax(event.target.value); pendingSaleKey.current = null; }} /></label>
          <label><span>Tip</span><input type="number" min="0" step="0.01" value={tip} onChange={(event) => { setTip(event.target.value); pendingSaleKey.current = null; }} /></label>
          <label><span>Handoff</span><select value={fulfillmentMode} onChange={(event) => { setFulfillmentMode(event.target.value); pendingSaleKey.current = null; }}><option value="immediate_handoff">Already handed off now</option><option value="pickup">Pickup later</option><option value="delivery">Delivery later</option></select></label>
          <div className="atlas-commerce-total"><small>Commercial total</small><strong>${(subtotal + Number(tax || 0) + Number(tip || 0)).toFixed(2)}</strong></div>
        </div>
        {fulfillmentMode !== "immediate_handoff" ? <div className="atlas-commerce-form__grid">
          <label><span>Due date</span><input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); pendingSaleKey.current = null; }} /></label>
          <label><span>Due time (optional)</span><input type="time" value={dueTime} onChange={(event) => { setDueTime(event.target.value); pendingSaleKey.current = null; }} /></label>
          <label><span>Fulfillment worker</span><select value={fulfillmentMembershipId} onChange={(event) => { setFulfillmentMembershipId(event.target.value); pendingSaleKey.current = null; }}>{farm.members.map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.role.replace("_", " ")}</option>)}</select></label>
        </div> : null}
        <label><span>Sale / handoff note (optional)</span><textarea rows={3} value={note} onChange={(event) => { setNote(event.target.value); pendingSaleKey.current = null; }} /></label>
        <button type="button" className="atlas-commerce__submit" disabled={saving || !canSubmit} onClick={() => void submitSale()}>{saving ? "Recording…" : fulfillmentMode === "immediate_handoff" ? "Record sale + handoff" : "Record sale"}</button>
        {message ? <p className="atlas-commerce__message">{message}</p> : null}
      </div>}
    </AtlasCard>

    <AtlasCard as="section" className="atlas-commerce" ariaLabelledBy="atlas-going-out-title">
      <header className="atlas-commerce__heading"><div><AtlasSectionHeading kicker="Committed inventory" title="Going out" id="atlas-going-out-title" /><p>Sold flower orders awaiting actual pickup or delivery. A due date is not fulfillment proof.</p></div></header>
      {data && !hasGoingOut ? <div className="atlas-commerce__empty"><b>No committed flower orders are awaiting handoff.</b></div> : null}
      {(data?.farms ?? []).filter((candidate) => candidate.goingOut.length).map((candidate) => <section className="atlas-commerce__farm" key={candidate.id}><header><small>Committed at</small><h3>{candidate.name}</h3></header><div className="atlas-commerce__list">{candidate.goingOut.map((order) => <article className="atlas-commerce-item" key={order.id}><div><small>{order.fulfillmentMode === "delivery" ? "Delivery" : "Pickup"} {prettyDate(order.fulfillmentDueDate)}</small><h4>{order.customerLabel}</h4><p>{order.lines.map((line) => `${amount(line.quantity, line.unit)} ${KIND_LABELS[line.inventoryKind] ?? line.inventoryKind}`).join(" · ")}</p></div><strong>${order.totalAmount.toFixed(2)}</strong></article>)}</div></section>)}
    </AtlasCard>

    <AtlasCard as="section" className="atlas-commerce" ariaLabelledBy="atlas-fulfilled-title">
      <header className="atlas-commerce__heading"><div><AtlasSectionHeading kicker="Actual handoff" title="Fulfilled" id="atlas-fulfilled-title" /><p>Completed commercial handoffs. These exist only after the customer actually receives the flowers.</p></div></header>
      {data && !hasFulfilled ? <div className="atlas-commerce__empty"><b>No flower fulfillment events have been recorded yet.</b></div> : null}
      {(data?.farms ?? []).filter((candidate) => candidate.fulfilled.length).map((candidate) => <section className="atlas-commerce__farm" key={candidate.id}><header><small>Fulfilled from</small><h3>{candidate.name}</h3></header><div className="atlas-commerce__list">{candidate.fulfilled.map((order) => <article className="atlas-commerce-item" key={order.id}><div><small>{prettyDateTime(order.fulfillment?.fulfilledAt)}</small><h4>{order.customerLabel}</h4><p>{order.salesChannel.replace(/_/g, " ")} · sold {prettyDate(order.saleDate)}</p></div><strong>${order.totalAmount.toFixed(2)}</strong></article>)}</div></section>)}
    </AtlasCard>
  </>;
}
