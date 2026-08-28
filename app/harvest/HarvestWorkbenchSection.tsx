"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import "./harvest-command-center.css";

type CropOption = { cropCycleId: string; cropLabel: string; variety: string | null; objectLabel: string };
type Product = { key: string; productLabel: string; inventoryKind: string; unit: string; stemsPerUnit: number | null; madeToday: number; lotIds: string[] };
type AvailableLot = { id: string; productKey: string; productLabel: string; inventoryKind: string; quantity: number; unit: string; stemsPerUnit: number | null; readyDate: string; preparationBatchId: string; availableQuantity: number };
type Activity = { id: string; at: string; date: string; kind: string; direction: string; label: string; detail: string | null; quantity: number | null; unit: string | null; productKey: string | null; source: string; actor: string };
type HarvestRun = { id: string; harvestDate: string; createdAt: string; actor: string; source: string; note: string | null; rows: Array<{ id: string; cropLabel: string; variety: string | null; objectLabel: string; bucketEquivalent: number; bucketHalves: number | null; moreAvailability: string }> };
type PrepRun = { id: string; preparedDate: string; createdAt: string; harvestBatchId: string; actor: string; source: string; note: string | null; outputs: Array<{ id: string; productLabel: string; inventoryKind: string; quantity: number; unit: string; stemsPerUnit: number | null }> };
type GoingOut = { id: string; customerLabel: string; salesChannel: string; saleDate: string; fulfillmentMode: string; fulfillmentDueDate: string | null; fulfillmentDueTime: string | null; fulfillmentTaskId: string | null; fulfillmentTaskStatus: string | null; totalAmount: number; lines: Array<{ id: string; readyLotId: string; productLabel: string; quantity: number; unit: string }> };
type LedgerFarm = { id: string; key: string; name: string; cropOptions: CropOption[]; products: Product[]; availableLots: AvailableLot[]; todayActivity: Activity[]; activity: Activity[]; batches: { harvest: HarvestRun[]; preparation: PrepRun[] }; goingOut: GoingOut[] };
type LedgerResponse = { ok?: boolean; error?: string; asOf?: string; farms?: LedgerFarm[] };

type Member = { id: string; role: string; workerKey: string | null; displayName: string };
type LotPosition = { readyLotId: string; birthQuantity: number; claimedQuantity: number; fulfilledQuantity: number; disposedQuantity: number; onRouteQuantity: number; availableQuantity: number };
type RouteLine = { id: string; readyLotId: string; productLabel: string; inventoryKind: string; quantity: number; unit: string; destinationLabel: string | null; state: string; onRouteQuantity: number; soldQuantity: number; returnedQuantity: number; otherReleasedQuantity: number };
type RouteLoad = { id: string; routeDate: string; routeLabel: string; assignedMembershipId: string | null; custodianLabel: string; custodianKind: string; note: string | null; createdAt: string; lines: RouteLine[]; activeQuantity: number; soldQuantity: number; returnedQuantity: number };
type CommandFarm = { id: string; lotPositions: LotPosition[]; routes: RouteLoad[]; activeRoutes: RouteLoad[]; members: Member[] };
type CommandResponse = { ok?: boolean; error?: string; farms?: CommandFarm[] };

type HarvestDraft = { id: string; cropCycleId: string; bucketHalves: number; moreAvailability: "yes" | "no" | "unsure" };
type PrepDraft = { id: string; productLabel: string; kind: "bundle" | "posy" | "bouquet" | "conditioned_bucket"; quantity: string; stemsPerUnit: string };
type MoveLine = { id: string; readyLotId: string; quantity: string; unitPrice: string; destinationLabel: string };
type SaleFromRouteDraft = { quantity: string; unitPrice: string; customerLabel: string };
type LedgerTab = "available" | "today" | "activity" | "batches";
type AssignMode = "customer" | "route";
type CustodianMode = "internal" | "external";

function localToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function prettyDate(value: string | null | undefined) { if (!value) return "Not set"; const d = new Date(`${value}T12:00:00`); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function prettyTime(value: string) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function countLabel(quantity: number, unit: string, stems: number | null = null) {
  const value = Number.isInteger(quantity) ? quantity.toFixed(0) : quantity.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  if (unit === "bucket_equivalent") return `${value} bucket${quantity === 1 ? "" : "s"}`;
  if (unit === "bunch") return `${value} bunch${quantity === 1 ? "" : "es"}${stems ? ` × ${stems} stems` : ""}`;
  if (unit === "posy") return `${value} ${quantity === 1 ? "posy" : "posies"}`;
  return `${value} ${unit.replace(/_/g, " ")}${quantity === 1 ? "" : "s"}`;
}
function halfBucketLabel(halves: number) { if (!halves) return "0"; const whole = Math.floor(halves / 2); const half = halves % 2; if (!whole && half) return "½ bucket"; if (whole === 1 && !half) return "1 bucket"; return `${whole}${half ? "½" : ""} buckets`; }
function sourceBadge(source: string) { return source.startsWith("Task") ? "TASK" : source === "Harvest tab" ? "HARVEST" : "ATLAS"; }

export default function HarvestWorkbenchSection() {
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [command, setCommand] = useState<CommandResponse | null>(null);
  const [farmId, setFarmId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [tab, setTab] = useState<LedgerTab>("available");
  const assignRef = useRef<HTMLDivElement | null>(null);
  const idCounter = useRef(10);
  const harvestKey = useRef<string | null>(null);
  const prepKey = useRef<string | null>(null);
  const moveKey = useRef<string | null>(null);
  const routeSaleKeys = useRef(new Map<string, string>());
  const routeReturnKeys = useRef(new Map<string, string>());
  const handoffKeys = useRef(new Map<string, string>());

  const [harvestRows, setHarvestRows] = useState<HarvestDraft[]>([{ id: "harvest-1", cropCycleId: "", bucketHalves: 0, moreAvailability: "yes" }]);
  const [harvestNote, setHarvestNote] = useState("");
  const [harvestBatchId, setHarvestBatchId] = useState("");
  const [prepRows, setPrepRows] = useState<PrepDraft[]>([{ id: "prep-1", productLabel: "", kind: "bundle", quantity: "1", stemsPerUnit: "5" }]);
  const [prepNote, setPrepNote] = useState("");

  const [assignMode, setAssignMode] = useState<AssignMode>("customer");
  const [moveLines, setMoveLines] = useState<MoveLine[]>([{ id: "move-1", readyLotId: "", quantity: "1", unitPrice: "0", destinationLabel: "" }]);
  const [customerLabel, setCustomerLabel] = useState("");
  const [salesChannel, setSalesChannel] = useState("wholesale");
  const [fulfillmentMode, setFulfillmentMode] = useState("delivery");
  const [dueDate, setDueDate] = useState(localToday());
  const [dueTime, setDueTime] = useState("");
  const [fulfillmentMembershipId, setFulfillmentMembershipId] = useState("");
  const [custodianMode, setCustodianMode] = useState<CustodianMode>("external");
  const [assignedMembershipId, setAssignedMembershipId] = useState("");
  const [externalCustodian, setExternalCustodian] = useState("");
  const [routeLabel, setRouteLabel] = useState("Florist sales route");
  const [routeNote, setRouteNote] = useState("");
  const [routeSales, setRouteSales] = useState<Record<string, SaleFromRouteDraft>>({});

  const nextId = (prefix: string) => `${prefix}-${++idCounter.current}`;

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const [ledgerResponse, commandResponse] = await Promise.all([
        fetch("/api/atlas/harvest-ledger", { cache: "no-store" }),
        fetch("/api/atlas/harvest-command-center", { cache: "no-store" }),
      ]);
      const ledgerPayload = await ledgerResponse.json() as LedgerResponse;
      const commandPayload = await commandResponse.json() as CommandResponse;
      if (!ledgerResponse.ok || !ledgerPayload.ok) throw new Error(ledgerPayload.error || "Flower history could not be loaded.");
      if (!commandResponse.ok || !commandPayload.ok) throw new Error(commandPayload.error || "Flower movement state could not be loaded.");
      setLedger(ledgerPayload); setCommand(commandPayload);
      const firstFarm = ledgerPayload.farms?.[0]?.id || commandPayload.farms?.[0]?.id || "";
      setFarmId((current) => current || firstFarm);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Harvest could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const farm = ledger?.farms?.find((item) => item.id === farmId) ?? ledger?.farms?.[0] ?? null;
  const commandFarm = command?.farms?.find((item) => item.id === farm?.id) ?? command?.farms?.[0] ?? null;
  const positionByLot = useMemo(() => new Map((commandFarm?.lotPositions ?? []).map((item) => [item.readyLotId, item])), [commandFarm]);
  const activeLots = useMemo(() => (farm?.availableLots ?? []).map((lot) => ({ ...lot, availableQuantity: positionByLot.get(lot.id)?.availableQuantity ?? lot.availableQuantity })).filter((lot) => lot.availableQuantity > 0), [farm, positionByLot]);

  useEffect(() => {
    if (!farm || harvestBatchId) return;
    const newest = [...farm.batches.harvest].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (newest) setHarvestBatchId(newest.id);
  }, [farm, harvestBatchId]);
  useEffect(() => {
    if (!commandFarm) return;
    if (!fulfillmentMembershipId) setFulfillmentMembershipId(commandFarm.members.find((member) => member.workerKey === "anna")?.id || commandFarm.members[0]?.id || "");
    if (!assignedMembershipId) setAssignedMembershipId(commandFarm.members.find((member) => member.workerKey === "anna")?.id || commandFarm.members[0]?.id || "");
  }, [commandFarm, fulfillmentMembershipId, assignedMembershipId]);

  const products = useMemo(() => (farm?.products ?? []).map((product) => {
    const positions = product.lotIds.map((id) => positionByLot.get(id)).filter(Boolean) as LotPosition[];
    return {
      ...product,
      availableNow: positions.reduce((sum, item) => sum + item.availableQuantity, 0),
      claimed: positions.reduce((sum, item) => sum + item.claimedQuantity, 0),
      onRoute: positions.reduce((sum, item) => sum + item.onRouteQuantity, 0),
      out: positions.reduce((sum, item) => sum + item.fulfilledQuantity, 0),
    };
  }).sort((a, b) => b.availableNow - a.availableNow || b.onRoute - a.onRoute || a.productLabel.localeCompare(b.productLabel)), [farm, positionByLot]);

  function clearMoveLines() { setMoveLines([{ id: nextId("move"), readyLotId: "", quantity: "1", unitPrice: "0", destinationLabel: "" }]); moveKey.current = null; }
  function primeMove(productKey: string, mode: AssignMode) {
    const lot = activeLots.find((item) => item.productKey === productKey);
    if (!lot) { setMessage("That product has no uncommitted Ready quantity right now."); return; }
    setAssignMode(mode);
    setMoveLines([{ id: nextId("move"), readyLotId: lot.id, quantity: "1", unitPrice: "0", destinationLabel: "" }]);
    moveKey.current = null;
    requestAnimationFrame(() => assignRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function submitHarvest() {
    if (!farm) return;
    const rows = harvestRows.filter((row) => row.cropCycleId && row.bucketHalves > 0);
    if (!rows.length) { setMessage("Choose a crop and record how much was cut."); return; }
    const key = harvestKey.current ?? `harvest-workbench:${crypto.randomUUID()}`; harvestKey.current = key;
    try {
      setSaving("harvest"); setMessage(null);
      const response = await fetch("/api/atlas/harvest-workbench", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "harvest", farmId: farm.id, rows, note: harvestNote.trim() || null, idempotencyKey: key }) });
      const payload = await response.json() as { ok?: boolean; error?: string; harvestBatchId?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Harvest could not be recorded.");
      setHarvestRows([{ id: nextId("harvest"), cropCycleId: "", bucketHalves: 0, moreAvailability: "yes" }]); setHarvestNote(""); harvestKey.current = null;
      if (payload.harvestBatchId) setHarvestBatchId(payload.harvestBatchId);
      setMessage("Harvest logged into the shared flower history."); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Harvest could not be recorded."); }
    finally { setSaving(null); }
  }

  async function submitPrep() {
    if (!farm || !harvestBatchId) { setMessage("Choose the harvest batch these flowers came from."); return; }
    const outputs = prepRows.map((row) => ({ kind: row.kind, productLabel: row.productLabel.trim(), quantity: Number(row.quantity), stemsPerUnit: row.kind === "bundle" ? Number(row.stemsPerUnit) : null }));
    if (outputs.some((row) => !row.productLabel || !Number.isFinite(row.quantity) || row.quantity <= 0 || (row.kind === "bundle" && (!Number.isInteger(row.stemsPerUnit) || Number(row.stemsPerUnit) < 1)))) { setMessage("Each finished line needs a flower, quantity, and stems per bunch when it is a bunch."); return; }
    const key = prepKey.current ?? `flower-prep-workbench:${crypto.randomUUID()}`; prepKey.current = key;
    try {
      setSaving("prep"); setMessage(null);
      const response = await fetch("/api/atlas/harvest-workbench", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", farmId: farm.id, harvestBatchId, outputs, note: prepNote.trim() || null, idempotencyKey: key }) });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Finished flowers could not be recorded.");
      setPrepRows([{ id: nextId("prep"), productLabel: "", kind: "bundle", quantity: "1", stemsPerUnit: "5" }]); setPrepNote(""); prepKey.current = null;
      setMessage("Finished flowers added to Ready as a separate prep run."); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Finished flowers could not be recorded."); }
    finally { setSaving(null); }
  }

  const validMoveLines = moveLines.every((line) => {
    const lot = activeLots.find((candidate) => candidate.id === line.readyLotId);
    const quantity = Number(line.quantity); const price = Number(line.unitPrice);
    return Boolean(lot && Number.isFinite(quantity) && quantity > 0 && quantity <= lot.availableQuantity && (assignMode === "route" || (Number.isFinite(price) && price >= 0)));
  });

  async function submitAssignment() {
    if (!farm || !commandFarm || !validMoveLines) { setMessage("Choose exact Ready flowers and a valid quantity."); return; }
    const key = moveKey.current ?? `harvest-command:${crypto.randomUUID()}`; moveKey.current = key;
    try {
      setSaving("assign"); setMessage(null);
      if (assignMode === "customer") {
        if (!customerLabel.trim()) throw new Error("Name the customer or destination.");
        if (fulfillmentMode !== "immediate_handoff" && (!dueDate || !fulfillmentMembershipId)) throw new Error("Choose when and who will handle the handoff.");
        const response = await fetch("/api/atlas/flower-commerce", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          farmId: farm.id, buyerRelationshipId: null, customerLabel: customerLabel.trim(), salesChannel,
          lines: moveLines.map((line) => ({ readyLotId: line.readyLotId, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) })), taxAmount: 0, tipAmount: 0,
          fulfillmentMode, fulfillmentDueDate: fulfillmentMode === "immediate_handoff" ? null : dueDate,
          fulfillmentDueTime: fulfillmentMode === "immediate_handoff" ? null : (dueTime || null),
          fulfillmentMembershipId: fulfillmentMode === "immediate_handoff" ? null : fulfillmentMembershipId, note: null, idempotencyKey: key,
        }) });
        const payload = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "The flowers could not be claimed.");
        setCustomerLabel("");
        setMessage("Flowers claimed. Available Now has been reduced immediately.");
      } else {
        const assigned = custodianMode === "internal" ? assignedMembershipId : null;
        const external = custodianMode === "external" ? externalCustodian.trim() : null;
        if ((!assigned && !external) || !routeLabel.trim()) throw new Error("Name who has the flowers and the route or purpose.");
        const response = await fetch("/api/atlas/flower-prospect-route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          action: "send", farmId: farm.id, assignedMembershipId: assigned, custodianLabel: external, routeDate: localToday(), routeLabel: routeLabel.trim(),
          lines: moveLines.map((line) => ({ readyLotId: line.readyLotId, quantity: Number(line.quantity), buyerRelationshipId: null, destinationLabel: line.destinationLabel.trim() || null })),
          note: routeNote.trim() || null, idempotencyKey: key,
        }) });
        const payload = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "The flowers could not be sent out.");
        setRouteNote("");
        setMessage(`Flowers are now out with ${external || commandFarm.members.find((member) => member.id === assigned)?.displayName || "their custodian"}. They are not counted as sold.`);
      }
      clearMoveLines(); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The flower movement could not be recorded."); }
    finally { setSaving(null); }
  }

  async function sellFromRoute(route: RouteLoad, line: RouteLine) {
    if (!farm) return;
    const draft = routeSales[line.id] ?? { quantity: "1", unitPrice: "0", customerLabel: "" };
    const quantity = Number(draft.quantity); const price = Number(draft.unitPrice);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > line.onRouteQuantity || !Number.isFinite(price) || price < 0) { setMessage("Enter a sold quantity still on the route and its unit price."); return; }
    const key = routeSaleKeys.current.get(line.id) ?? `prospect-sale:${crypto.randomUUID()}`; routeSaleKeys.current.set(line.id, key);
    try {
      setSaving(`route-sale:${line.id}`); setMessage(null);
      const response = await fetch("/api/atlas/flower-prospect-route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sell", farmId: farm.id, prospectRouteLineId: line.id, quantity, unitPrice: price, customerLabel: draft.customerLabel.trim() || route.custodianLabel, salesChannel: "wholesale", note: `Sold from ${route.routeLabel}`, idempotencyKey: key }) });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Route sale could not be recorded.");
      routeSaleKeys.current.delete(line.id); setRouteSales((current) => ({ ...current, [line.id]: { quantity: "1", unitPrice: draft.unitPrice, customerLabel: "" } }));
      setMessage("Sale recorded. Only the sold quantity became sale truth; the rest remains on route."); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Route sale could not be recorded."); }
    finally { setSaving(null); }
  }

  async function returnRoute(route: RouteLoad) {
    if (!farm) return;
    const key = routeReturnKeys.current.get(route.id) ?? `prospect-return:${crypto.randomUUID()}`; routeReturnKeys.current.set(route.id, key);
    try {
      setSaving(`route-return:${route.id}`); setMessage(null);
      const response = await fetch("/api/atlas/flower-prospect-route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "return", farmId: farm.id, prospectRouteId: route.id, note: `Unsold flowers returned from ${route.routeLabel}`, idempotencyKey: key }) });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Route return could not be recorded.");
      routeReturnKeys.current.delete(route.id); setMessage("Remaining route flowers returned to Available Now."); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Route return could not be recorded."); }
    finally { setSaving(null); }
  }

  async function completeHandoff(order: GoingOut) {
    if (!order.fulfillmentTaskId) { setMessage("This order has no fulfillment task yet."); return; }
    const key = handoffKeys.current.get(order.id) ?? `harvest-handoff:${crypto.randomUUID()}`; handoffKeys.current.set(order.id, key);
    try {
      setSaving(`handoff:${order.id}`); setMessage(null);
      const response = await fetch("/api/atlas/flower-fulfillment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: order.fulfillmentTaskId, idempotencyKey: key, note: null }) });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Handoff could not be recorded.");
      handoffKeys.current.delete(order.id); setMessage("Handoff complete. Those flowers are now Out, not Available."); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Handoff could not be recorded."); }
    finally { setSaving(null); }
  }

  const routeActivities = useMemo<Activity[]>(() => (commandFarm?.routes ?? []).map((route) => ({ id: `route:${route.id}`, at: route.createdAt, date: route.routeDate, kind: "route", direction: "out", label: route.routeLabel, detail: `${route.custodianLabel} · ${route.lines.map((line) => `${countLabel(line.quantity, line.unit)} ${line.productLabel}`).join(" · ")}`, quantity: route.activeQuantity, unit: null, productKey: null, source: "Harvest tab", actor: "Atlas" })), [commandFarm]);
  const fullActivity = useMemo(() => [...(farm?.activity ?? []), ...routeActivities].sort((a, b) => b.at.localeCompare(a.at)), [farm, routeActivities]);
  const todayActivity = fullActivity.filter((activity) => activity.date === (ledger?.asOf || localToday()));
  const batches = useMemo(() => farm ? [...farm.batches.harvest.map((batch) => ({ type: "HARVEST", id: batch.id, at: batch.createdAt, batch })), ...farm.batches.preparation.map((batch) => ({ type: "PREP", id: batch.id, at: batch.createdAt, batch }))].sort((a, b) => b.at.localeCompare(a.at)) : [], [farm]);

  if (loading && !ledger) return <section className="flower-command"><div className="flower-command__loading">Loading the flower command center…</div></section>;

  return (
    <section className="flower-command" data-harvest-workbench="permanent-task-cards">
      <header className="flower-command__intro">
        <div><span>FLOWER COMMAND CENTER</span><h1>Do the work. See what exists. Move it without losing it.</h1><p>Scheduled tasks and anything logged here accumulate into the same flower history.</p></div>
        {(ledger?.farms?.length ?? 0) > 1 ? <select value={farm?.id || ""} onChange={(event) => setFarmId(event.target.value)}>{ledger?.farms?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select> : null}
      </header>

      {error ? <div className="flower-command__notice flower-command__notice--error"><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div> : null}
      {message ? <div className="flower-command__notice"><span>{message}</span><button type="button" onClick={() => setMessage(null)}>×</button></div> : null}

      {farm && commandFarm ? <div className="flower-command__cards">
        <AtlasTaskCardFrame family="HARVEST" familyDetail="Permanent card" title="Harvest Stems" subtitle="Log another cut any time." timing="Same physical harvest truth as a Harvest task." completion={<button type="button" className="flower-command__primary" disabled={saving === "harvest"} onClick={() => void submitHarvest()}>{saving === "harvest" ? "Logging…" : "Log harvest"}</button>}>
          <div className="flower-command__body">
            {harvestRows.map((row, index) => <div className="flower-command__harvest-row" key={row.id}>
              <label><span>{index ? "Another crop" : "What did you cut?"}</span><select value={row.cropCycleId} onChange={(event) => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, cropCycleId: event.target.value } : item)); }}><option value="">Choose crop + bed</option>{farm.cropOptions.map((crop) => <option key={crop.cropCycleId} value={crop.cropCycleId}>{crop.objectLabel} · {crop.cropLabel}{crop.variety ? ` · ${crop.variety}` : ""}</option>)}</select></label>
              <div className="flower-command__counter"><button type="button" onClick={() => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, bucketHalves: Math.max(0, item.bucketHalves - 1) } : item)); }}>−</button><strong>{halfBucketLabel(row.bucketHalves)}</strong><button type="button" onClick={() => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, bucketHalves: Math.min(40, item.bucketHalves + 1) } : item)); }}>+</button></div>
              <div className="flower-command__choice"><span>More still out there?</span>{(["yes", "unsure", "no"] as const).map((value) => <button type="button" key={value} data-selected={row.moreAvailability === value ? "true" : "false"} onClick={() => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, moreAvailability: value } : item)); }}>{value === "yes" ? "Yes" : value === "no" ? "No" : "Not sure"}</button>)}</div>
              {harvestRows.length > 1 ? <button type="button" className="flower-command__text" onClick={() => setHarvestRows((current) => current.filter((item) => item.id !== row.id))}>Remove row</button> : null}
            </div>)}
            <button type="button" className="flower-command__add" onClick={() => setHarvestRows((current) => [...current, { id: nextId("harvest"), cropCycleId: "", bucketHalves: 0, moreAvailability: "yes" }])}>+ Add another crop</button>
            <label><span>Field note <small>optional</small></span><input value={harvestNote} onChange={(event) => { harvestKey.current = null; setHarvestNote(event.target.value); }} placeholder="Anything useful about this cut" /></label>
          </div>
        </AtlasTaskCardFrame>

        <AtlasTaskCardFrame family="POST-HARVEST" familyDetail="Permanent card" title="Condition + Bunch" subtitle="Log another finished batch whenever more gets made." timing="Runs stay separate. Ready inventory accumulates." completion={<button type="button" className="flower-command__primary" disabled={saving === "prep"} onClick={() => void submitPrep()}>{saving === "prep" ? "Recording…" : "Add finished flowers"}</button>}>
          <div className="flower-command__body">
            <label><span>Which harvest did these come from?</span><select value={harvestBatchId} onChange={(event) => { prepKey.current = null; setHarvestBatchId(event.target.value); }}><option value="">Choose harvest batch</option>{farm.batches.harvest.map((batch) => <option key={batch.id} value={batch.id}>{prettyDate(batch.harvestDate)} · {batch.rows.map((row) => row.cropLabel).filter((value, index, all) => all.indexOf(value) === index).join(" + ") || "Harvest"} · {batch.actor}</option>)}</select></label>
            {prepRows.map((row, index) => <div className="flower-command__line" key={row.id}><span>{index + 1}</span><input aria-label="Flower" placeholder="Sunflower" value={row.productLabel} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, productLabel: event.target.value } : item)); }} /><select aria-label="Finished form" value={row.kind} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, kind: event.target.value as PrepDraft["kind"] } : item)); }}><option value="bundle">Bunch</option><option value="posy">Posy</option><option value="bouquet">Bouquet</option><option value="conditioned_bucket">DIY bucket</option></select><input aria-label="Quantity" type="number" min="0" step={row.kind === "conditioned_bucket" ? ".25" : "1"} value={row.quantity} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, quantity: event.target.value } : item)); }} />{row.kind === "bundle" ? <label className="flower-command__stems"><input aria-label="Stems each" type="number" min="1" value={row.stemsPerUnit} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, stemsPerUnit: event.target.value } : item)); }} /><small>stems</small></label> : null}{prepRows.length > 1 ? <button type="button" className="flower-command__remove" onClick={() => setPrepRows((current) => current.filter((item) => item.id !== row.id))}>×</button> : null}</div>)}
            <button type="button" className="flower-command__add" onClick={() => setPrepRows((current) => [...current, { id: nextId("prep"), productLabel: "", kind: "bundle", quantity: "1", stemsPerUnit: "5" }])}>+ Add another finished item</button>
            <label><span>Prep note <small>optional</small></span><input value={prepNote} onChange={(event) => { prepKey.current = null; setPrepNote(event.target.value); }} placeholder="Anything about this batch" /></label>
          </div>
        </AtlasTaskCardFrame>

        <div ref={assignRef}>
          <AtlasTaskCardFrame family="MOVEMENT" familyDetail="Permanent card" title="Assign / Send" subtitle="Take exact Ready flowers out of Available without losing where they went." timing={`${activeLots.length} Ready lot${activeLots.length === 1 ? "" : "s"} available now.`} completion={<button type="button" className="flower-command__primary" disabled={saving === "assign" || !validMoveLines} onClick={() => void submitAssignment()}>{saving === "assign" ? "Saving…" : assignMode === "customer" ? "Claim these flowers" : "Send these flowers"}</button>}>
            <div className="flower-command__body">
              <div className="flower-command__mode"><button type="button" data-selected={assignMode === "customer" ? "true" : "false"} onClick={() => { setAssignMode("customer"); moveKey.current = null; }}>Customer / order</button><button type="button" data-selected={assignMode === "route" ? "true" : "false"} onClick={() => { setAssignMode("route"); moveKey.current = null; }}>Route / samples</button></div>

              {assignMode === "customer" ? <>
                <label><span>Customer / destination</span><input value={customerLabel} onChange={(event) => { moveKey.current = null; setCustomerLabel(event.target.value); }} placeholder="Florist, pickup customer, event…" /></label>
                <div className="flower-command__two"><label><span>Channel</span><select value={salesChannel} onChange={(event) => { moveKey.current = null; setSalesChannel(event.target.value); }}><option value="wholesale">Wholesale</option><option value="farm_pickup">Farm pickup</option><option value="delivery">Delivery</option><option value="market">Market</option><option value="event">Event</option><option value="other">Other</option></select></label><label><span>Handoff</span><select value={fulfillmentMode} onChange={(event) => { moveKey.current = null; setFulfillmentMode(event.target.value); }}><option value="delivery">Delivery later</option><option value="pickup">Pickup later</option><option value="immediate_handoff">Handing over now</option></select></label></div>
                {fulfillmentMode !== "immediate_handoff" ? <div className="flower-command__three"><label><span>Date</span><input type="date" value={dueDate} onChange={(event) => { moveKey.current = null; setDueDate(event.target.value); }} /></label><label><span>Time <small>optional</small></span><input type="time" value={dueTime} onChange={(event) => { moveKey.current = null; setDueTime(event.target.value); }} /></label><label><span>Who handles it?</span><select value={fulfillmentMembershipId} onChange={(event) => { moveKey.current = null; setFulfillmentMembershipId(event.target.value); }}>{commandFarm.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label></div> : null}
              </> : <>
                <div className="flower-command__mode flower-command__mode--small"><button type="button" data-selected={custodianMode === "external" ? "true" : "false"} onClick={() => { setCustodianMode("external"); moveKey.current = null; }}>Someone outside Atlas</button><button type="button" data-selected={custodianMode === "internal" ? "true" : "false"} onClick={() => { setCustodianMode("internal"); moveKey.current = null; }}>Atlas worker</button></div>
                {custodianMode === "external" ? <label><span>Who has the flowers?</span><input value={externalCustodian} onChange={(event) => { moveKey.current = null; setExternalCustodian(event.target.value); }} placeholder="Katie" /></label> : <label><span>Who has the flowers?</span><select value={assignedMembershipId} onChange={(event) => { moveKey.current = null; setAssignedMembershipId(event.target.value); }}>{commandFarm.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>}
                <label><span>Route / purpose</span><input value={routeLabel} onChange={(event) => { moveKey.current = null; setRouteLabel(event.target.value); }} placeholder="Florist sales route" /></label>
              </>}

              {moveLines.map((line, index) => { const lot = activeLots.find((item) => item.id === line.readyLotId); return <div className="flower-command__move-line" key={line.id}><span>{index + 1}</span><select aria-label="Ready flowers" value={line.readyLotId} onChange={(event) => { moveKey.current = null; setMoveLines((current) => current.map((item) => item.id === line.id ? { ...item, readyLotId: event.target.value } : item)); }}><option value="">Choose Ready flowers</option>{activeLots.map((item) => <option key={item.id} value={item.id}>{item.productLabel} · {countLabel(item.availableQuantity, item.unit, item.stemsPerUnit)} available</option>)}</select><input aria-label="Quantity" type="number" min="0" max={lot?.availableQuantity} step={lot?.inventoryKind === "conditioned_bucket" ? ".25" : "1"} value={line.quantity} onChange={(event) => { moveKey.current = null; setMoveLines((current) => current.map((item) => item.id === line.id ? { ...item, quantity: event.target.value } : item)); }} />{assignMode === "customer" ? <label className="flower-command__price"><span>$</span><input aria-label="Unit price" type="number" min="0" step=".01" value={line.unitPrice} onChange={(event) => { moveKey.current = null; setMoveLines((current) => current.map((item) => item.id === line.id ? { ...item, unitPrice: event.target.value } : item)); }} /></label> : <input aria-label="Route stop" placeholder="Stop / florist optional" value={line.destinationLabel} onChange={(event) => { moveKey.current = null; setMoveLines((current) => current.map((item) => item.id === line.id ? { ...item, destinationLabel: event.target.value } : item)); }} />}{moveLines.length > 1 ? <button type="button" className="flower-command__remove" onClick={() => setMoveLines((current) => current.filter((item) => item.id !== line.id))}>×</button> : null}</div>; })}
              <button type="button" className="flower-command__add" onClick={() => setMoveLines((current) => [...current, { id: nextId("move"), readyLotId: "", quantity: "1", unitPrice: "0", destinationLabel: "" }])}>+ Add another Ready item</button>
              {assignMode === "route" ? <label><span>Route note <small>optional</small></span><input value={routeNote} onChange={(event) => { moveKey.current = null; setRouteNote(event.target.value); }} placeholder="Samples, target shops, instructions…" /></label> : null}
            </div>
          </AtlasTaskCardFrame>
        </div>

        <AtlasTaskCardFrame family="MOVEMENT" familyDetail="Permanent card" title="Going Out" subtitle="Flowers that have left Available but are not simply gone." timing={`${commandFarm.activeRoutes.length} route${commandFarm.activeRoutes.length === 1 ? "" : "s"} · ${farm.goingOut.length} customer handoff${farm.goingOut.length === 1 ? "" : "s"}`} completion={<span className="flower-command__completion">Sold, returned, and handed-off quantities resolve here.</span>}>
          <div className="flower-command__body flower-command__going-out">
            {commandFarm.activeRoutes.map((route) => <article className="flower-command__route" key={route.id}>
              <header><div><small>WITH {route.custodianLabel.toUpperCase()}</small><h3>{route.routeLabel}</h3><p>{prettyDate(route.routeDate)} · {route.soldQuantity ? `${route.soldQuantity} sold · ` : ""}{route.activeQuantity} still out</p></div><button type="button" disabled={saving === `route-return:${route.id}`} onClick={() => void returnRoute(route)}>{saving === `route-return:${route.id}` ? "Returning…" : "Return remaining"}</button></header>
              {route.lines.filter((line) => line.onRouteQuantity > 0).map((line) => { const draft = routeSales[line.id] ?? { quantity: "1", unitPrice: "0", customerLabel: "" }; return <div className="flower-command__route-line" key={line.id}><div><b>{line.productLabel}</b><span>{countLabel(line.onRouteQuantity, line.unit)} still with {route.custodianLabel}{line.soldQuantity ? ` · ${countLabel(line.soldQuantity, line.unit)} sold` : ""}</span></div><div className="flower-command__route-sale"><input aria-label="Sold quantity" type="number" min="0" max={line.onRouteQuantity} step={line.inventoryKind === "conditioned_bucket" ? ".25" : "1"} value={draft.quantity} onChange={(event) => setRouteSales((current) => ({ ...current, [line.id]: { ...draft, quantity: event.target.value } }))} /><label><span>$</span><input aria-label="Sold unit price" type="number" min="0" step=".01" value={draft.unitPrice} onChange={(event) => setRouteSales((current) => ({ ...current, [line.id]: { ...draft, unitPrice: event.target.value } }))} /></label><input aria-label="Buyer optional" placeholder="Buyer optional" value={draft.customerLabel} onChange={(event) => setRouteSales((current) => ({ ...current, [line.id]: { ...draft, customerLabel: event.target.value } }))} /><button type="button" disabled={saving === `route-sale:${line.id}`} onClick={() => void sellFromRoute(route, line)}>{saving === `route-sale:${line.id}` ? "Saving…" : "Sold"}</button></div></div>; })}
            </article>)}

            {farm.goingOut.map((order) => <article className="flower-command__handoff" key={order.id}><div><small>{order.fulfillmentMode === "pickup" ? "PICKUP" : "DELIVERY"}{order.fulfillmentDueDate ? ` · ${prettyDate(order.fulfillmentDueDate)}` : ""}{order.fulfillmentDueTime ? ` · ${order.fulfillmentDueTime.slice(0,5)}` : ""}</small><h3>{order.customerLabel}</h3><p>{order.lines.map((line) => `${countLabel(line.quantity, line.unit)} ${line.productLabel}`).join(" · ")}</p></div><button type="button" disabled={!order.fulfillmentTaskId || saving === `handoff:${order.id}`} onClick={() => void completeHandoff(order)}>{saving === `handoff:${order.id}` ? "Saving…" : "Handed off"}</button></article>)}

            {!commandFarm.activeRoutes.length && !farm.goingOut.length ? <div className="flower-command__empty"><b>Nothing is out right now.</b><span>Routes, pickups, and deliveries appear here the moment flowers leave Available.</span></div> : null}
          </div>
        </AtlasTaskCardFrame>
      </div> : null}

      {farm && commandFarm ? <section className="flower-ledger" aria-labelledby="flower-ledger-title">
        <header><div><span>LIVE FLOWER INVENTORY</span><h2 id="flower-ledger-title">What can I sell right now?</h2><p>Ready is cumulative. Claims, route custody, handoffs, returns, and sales change the same position.</p></div><div className="flower-ledger__summary"><strong>{products.reduce((sum, product) => sum + product.availableNow, 0)}</strong><span>available now</span><strong>{products.reduce((sum, product) => sum + product.onRoute, 0)}</strong><span>on route</span></div></header>
        <nav>{([['available','AVAILABLE NOW'],['today','TODAY'],['activity','ACTIVITY'],['batches','BATCHES']] as Array<[LedgerTab,string]>).map(([value,label]) => <button type="button" key={value} data-selected={tab === value ? "true" : "false"} onClick={() => setTab(value)}>{label}</button>)}</nav>

        {tab === "available" ? <div className="flower-ledger__table"><div className="flower-ledger__head"><span>Product</span><span>Made today</span><span>Claimed</span><span>On route</span><span>Out</span><span>Available now</span><span /></div>{products.map((product) => <div className="flower-ledger__product" key={product.key}><div><b>{product.productLabel}</b><small>{product.inventoryKind === "bunch" && product.stemsPerUnit ? `${product.stemsPerUnit}-stem bunch` : product.inventoryKind.replace(/_/g," ")}</small></div><span>{product.madeToday}</span><span>{product.claimed}</span><span>{product.onRoute}</span><span>{product.out}</span><strong>{product.availableNow}</strong><div className="flower-ledger__actions"><button type="button" disabled={product.availableNow <= 0} onClick={() => primeMove(product.key,"customer")}>Claim</button><button type="button" disabled={product.availableNow <= 0} onClick={() => primeMove(product.key,"route")}>Send</button></div></div>)}</div> : null}

        {tab === "today" || tab === "activity" ? <div className="flower-ledger__activity">{(tab === "today" ? todayActivity : fullActivity).length ? (tab === "today" ? todayActivity : fullActivity).map((item) => <article key={item.id}><time>{prettyTime(item.at)}</time><div><b>{item.label}</b><span>{item.detail}</span></div>{item.quantity !== null && item.unit ? <strong>{item.direction === "out" ? "−" : item.direction === "in" ? "+" : ""}{countLabel(item.quantity,item.unit)}</strong> : null}<small data-source={sourceBadge(item.source)}>{sourceBadge(item.source)} · {item.actor}</small></article>) : <div className="flower-command__empty"><b>No movement in this view.</b></div>}</div> : null}

        {tab === "batches" ? <div className="flower-ledger__batches">{batches.map((entry) => <article key={`${entry.type}:${entry.id}`}><header><span>{entry.type}</span><time>{prettyTime(entry.at)} · {entry.type === "HARVEST" ? prettyDate((entry.batch as HarvestRun).harvestDate) : prettyDate((entry.batch as PrepRun).preparedDate)}</time></header>{entry.type === "HARVEST" ? <>{(entry.batch as HarvestRun).rows.map((row) => <p key={row.id}><b>{row.cropLabel}{row.variety ? ` · ${row.variety}` : ""}</b><span>{row.objectLabel} · {countLabel(row.bucketEquivalent,"bucket_equivalent")}</span></p>)}</> : <>{(entry.batch as PrepRun).outputs.map((output) => <p key={output.id}><b>{output.productLabel}</b><span>{countLabel(output.quantity,output.unit,output.stemsPerUnit)}</span></p>)}</>}<footer>{(entry.batch as HarvestRun | PrepRun).source} · {(entry.batch as HarvestRun | PrepRun).actor}</footer></article>)}</div> : null}
      </section> : null}
    </section>
  );
}
