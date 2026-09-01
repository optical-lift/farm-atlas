"use client";

import { useEffect, useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import FlowerDemandSection from "./FlowerDemandSection";
import "./harvest-outbound.css";

export type HarvestOutboundOrder = {
  id: string;
  customerLabel: string;
  salesChannel: string;
  saleDate: string;
  fulfillmentMode: string;
  fulfillmentDueDate: string | null;
  fulfillmentDueTime: string | null;
  fulfillmentTaskId: string | null;
  fulfillmentTaskStatus: string | null;
  totalAmount: number;
  lines: Array<{ id: string; readyLotId: string; productLabel: string; quantity: number; unit: string }>;
};

export type HarvestOutboundRouteLine = {
  id: string;
  readyLotId: string;
  productLabel: string;
  inventoryKind: string;
  quantity: number;
  unit: string;
  destinationLabel: string | null;
  state: string;
  onRouteQuantity: number;
  soldQuantity: number;
  returnedQuantity: number;
  otherReleasedQuantity: number;
};

export type HarvestOutboundRoute = {
  id: string;
  routeDate: string;
  routeLabel: string;
  assignedMembershipId: string | null;
  custodianLabel: string;
  custodianKind: string;
  note: string | null;
  createdAt: string;
  lines: HarvestOutboundRouteLine[];
  activeQuantity: number;
  soldQuantity: number;
  returnedQuantity: number;
};

export type HarvestOutboundSaleDraft = { quantity: string; unitPrice: string; customerLabel: string };

type OutboundView = "pickup" | "delivery" | "route";

type Props = {
  title?: string;
  orders: HarvestOutboundOrder[];
  routes: HarvestOutboundRoute[];
  saving: string | null;
  routeSales: Record<string, HarvestOutboundSaleDraft>;
  onRouteSaleDraftChange: (lineId: string, next: HarvestOutboundSaleDraft) => void;
  onSellFromRoute: (route: HarvestOutboundRoute, line: HarvestOutboundRouteLine) => void | Promise<void>;
  onReturnRoute: (route: HarvestOutboundRoute) => void | Promise<void>;
  onCompleteHandoff: (order: HarvestOutboundOrder) => void | Promise<void>;
};

function prettyDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function prettyClock(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{2}):(\d{2})/);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function countLabel(quantity: number, unit: string) {
  const value = Number.isInteger(quantity) ? quantity.toFixed(0) : quantity.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  if (unit === "bunch") return `${value} bunch${quantity === 1 ? "" : "es"}`;
  if (unit === "posy") return `${value} ${quantity === 1 ? "posy" : "posies"}`;
  return `${value} ${unit.replace(/_/g, " ")}${quantity === 1 ? "" : "s"}`;
}

function orderCode(order: HarvestOutboundOrder) {
  return order.id.slice(0, 4).toUpperCase();
}

function moneyLabel(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return "No charge";
  return `$${amount.toFixed(2)}`;
}

export default function HarvestOutboundSection({
  title = "Going Out",
  orders,
  routes,
  saving,
  routeSales,
  onRouteSaleDraftChange,
  onSellFromRoute,
  onReturnRoute,
  onCompleteHandoff,
}: Props) {
  const pickups = useMemo(() => orders.filter((order) => order.fulfillmentMode === "pickup"), [orders]);
  const deliveries = useMemo(() => orders.filter((order) => order.fulfillmentMode !== "pickup"), [orders]);
  const [view, setView] = useState<OutboundView>(pickups.length ? "pickup" : deliveries.length ? "delivery" : "route");

  useEffect(() => {
    if (view === "pickup" && !pickups.length && deliveries.length) setView("delivery");
    else if (view === "pickup" && !pickups.length && !deliveries.length && routes.length) setView("route");
    else if (view === "delivery" && !deliveries.length && pickups.length) setView("pickup");
    else if (view === "delivery" && !deliveries.length && !pickups.length && routes.length) setView("route");
    else if (view === "route" && !routes.length && pickups.length) setView("pickup");
    else if (view === "route" && !routes.length && !pickups.length && deliveries.length) setView("delivery");
  }, [view, pickups.length, deliveries.length, routes.length]);

  const totalActive = pickups.length + deliveries.length + routes.length;

  return (
    <>
      <FlowerDemandSection />
      <AtlasTaskCardFrame
        family="MOVEMENT"
        familyDetail="Permanent card"
        title={title}
        subtitle="Pickups, deliveries, and route custody all resolve from the same flower inventory."
        timing={`${pickups.length} pickup${pickups.length === 1 ? "" : "s"} · ${deliveries.length} deliver${deliveries.length === 1 ? "y" : "ies"} · ${routes.length} route${routes.length === 1 ? "" : "s"}`}
        completion={<span className="harvest-outbound__completion">Picked up, delivered, sold, and returned quantities resolve here.</span>}
      >
        <div className="harvest-outbound" data-harvest-outbound="pickup-delivery-route">
          <nav className="harvest-outbound__views" aria-label="Going out views">
            <button type="button" data-selected={view === "pickup" ? "true" : "false"} onClick={() => setView("pickup")}>Pickup Dock <span>{pickups.length}</span></button>
            <button type="button" data-selected={view === "delivery" ? "true" : "false"} onClick={() => setView("delivery")}>Deliveries <span>{deliveries.length}</span></button>
            <button type="button" data-selected={view === "route" ? "true" : "false"} onClick={() => setView("route")}>On Route <span>{routes.length}</span></button>
          </nav>

          {view === "pickup" ? <section className="harvest-outbound__dock" aria-label="Pickup Dock">
            <header className="harvest-outbound__dock-header">
              <div><small>PICKUP DOCK</small><strong>Ready for pickup</strong></div>
              <span>{pickups.length ? `${pickups.length} waiting` : "Clear"}</span>
            </header>
            {pickups.length ? <div className="harvest-outbound__order-list">
              {pickups.map((order) => <article className="harvest-outbound__order" key={order.id}>
                <div className="harvest-outbound__order-topline">
                  <div className="harvest-outbound__order-identity"><strong>#{orderCode(order)}</strong><span>{prettyClock(order.fulfillmentDueTime) || prettyDate(order.fulfillmentDueDate)}</span></div>
                  <span className="harvest-outbound__amount">{moneyLabel(order.totalAmount)}</span>
                </div>
                <h3>{order.customerLabel}</h3>
                <ul>{order.lines.map((line) => <li key={line.id}>{countLabel(line.quantity, line.unit)} {line.productLabel}</li>)}</ul>
                <footer>
                  {order.fulfillmentTaskId ? <a href={`/task-focus/${order.fulfillmentTaskId}`}>Open handoff task</a> : <span className="harvest-outbound__needs-task">Handoff task missing</span>}
                  <button type="button" className="harvest-outbound__primary" disabled={!order.fulfillmentTaskId || saving === `handoff:${order.id}`} onClick={() => void onCompleteHandoff(order)}>{saving === `handoff:${order.id}` ? "Saving…" : "Picked up"}</button>
                </footer>
              </article>)}
            </div> : <div className="harvest-outbound__empty"><b>No pickups waiting.</b><span>A Pickup later claim appears here automatically.</span></div>}
          </section> : null}

          {view === "delivery" ? <section className="harvest-outbound__deliveries" aria-label="Deliveries">
            {deliveries.length ? deliveries.map((order) => <article className="harvest-outbound__delivery" key={order.id}>
              <header>
                <div><small>{order.fulfillmentMode === "immediate_handoff" ? "HANDOFF NOW" : "DELIVERY"} · #{orderCode(order)}</small><h3>{order.customerLabel}</h3></div>
                <span>{order.fulfillmentDueDate ? prettyDate(order.fulfillmentDueDate) : "Today"}{prettyClock(order.fulfillmentDueTime) ? ` · ${prettyClock(order.fulfillmentDueTime)}` : ""}</span>
              </header>
              <ul>{order.lines.map((line) => <li key={line.id}>{countLabel(line.quantity, line.unit)} {line.productLabel}</li>)}</ul>
              <footer>
                <span>{moneyLabel(order.totalAmount)} order</span>
                <div>{order.fulfillmentTaskId ? <a href={`/task-focus/${order.fulfillmentTaskId}`}>Open task</a> : null}<button type="button" className="harvest-outbound__primary" disabled={!order.fulfillmentTaskId || saving === `handoff:${order.id}`} onClick={() => void onCompleteHandoff(order)}>{saving === `handoff:${order.id}` ? "Saving…" : order.fulfillmentMode === "immediate_handoff" ? "Handed off" : "Delivered"}</button></div>
              </footer>
            </article>) : <div className="harvest-outbound__empty"><b>No deliveries waiting.</b><span>Delivery commitments appear here with their exact Ready goods attached.</span></div>}
          </section> : null}

          {view === "route" ? <section className="harvest-outbound__routes" aria-label="On Route">
            {routes.length ? routes.map((route) => <article className="harvest-outbound__route" key={route.id}>
              <header><div><small>WITH {route.custodianLabel.toUpperCase()}</small><h3>{route.routeLabel}</h3><p>{prettyDate(route.routeDate)} · {route.soldQuantity ? `${route.soldQuantity} sold · ` : ""}{route.activeQuantity} still out</p></div><button type="button" disabled={saving === `route-return:${route.id}`} onClick={() => void onReturnRoute(route)}>{saving === `route-return:${route.id}` ? "Returning…" : "Return remaining"}</button></header>
              {route.lines.filter((line) => line.onRouteQuantity > 0).map((line) => {
                const draft = routeSales[line.id] ?? { quantity: "1", unitPrice: "0", customerLabel: "" };
                return <div className="harvest-outbound__route-line" key={line.id}>
                  <div><b>{line.productLabel}</b><span>{countLabel(line.onRouteQuantity, line.unit)} still with {route.custodianLabel}{line.soldQuantity ? ` · ${countLabel(line.soldQuantity, line.unit)} sold` : ""}</span></div>
                  <div className="harvest-outbound__route-sale">
                    <input aria-label="Sold quantity" type="number" min="0" max={line.onRouteQuantity} step={line.inventoryKind === "conditioned_bucket" ? ".25" : "1"} value={draft.quantity} onChange={(event) => onRouteSaleDraftChange(line.id, { ...draft, quantity: event.target.value })} />
                    <label><span>$</span><input aria-label="Sold unit price" type="number" min="0" step=".01" value={draft.unitPrice} onChange={(event) => onRouteSaleDraftChange(line.id, { ...draft, unitPrice: event.target.value })} /></label>
                    <input aria-label="Buyer optional" placeholder="Buyer optional" value={draft.customerLabel} onChange={(event) => onRouteSaleDraftChange(line.id, { ...draft, customerLabel: event.target.value })} />
                    <button type="button" disabled={saving === `route-sale:${line.id}`} onClick={() => void onSellFromRoute(route, line)}>{saving === `route-sale:${line.id}` ? "Saving…" : "Sold"}</button>
                  </div>
                </div>;
              })}
            </article>) : <div className="harvest-outbound__empty"><b>No flowers are on a sales route.</b><span>Sending Ready goods with Katie or another custodian moves them here without calling them sold.</span></div>}
          </section> : null}

          {!totalActive ? <p className="harvest-outbound__all-clear">Nothing is out right now. Available inventory is still at Elm.</p> : null}
        </div>
      </AtlasTaskCardFrame>
    </>
  );
}
