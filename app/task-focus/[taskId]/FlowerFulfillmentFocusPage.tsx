"use client";

import Link from "next/link";
import { useState } from "react";

import styles from "./HarvestFocus.module.css";

export type FlowerFulfillmentLine = {
  id: string;
  inventoryKind: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
};

export type FlowerFulfillmentTask = {
  id: string;
  dueDate: string | null;
  saleOrderId: string;
  customerLabel: string;
  salesChannel: string;
  eventKey: string | null;
  saleDate: string;
  fulfillmentMode: string;
  fulfillmentDueDate: string | null;
  fulfillmentDueTime: string | null;
  totalAmount: number;
  note: string | null;
  lines: FlowerFulfillmentLine[];
  returnTo?: string | null;
};

const KIND_LABELS: Record<string, string> = {
  conditioned_bucket: "Conditioned flowers",
  counted_stems: "Counted stems",
  posy: "Posy",
  bouquet: "Bouquet",
  lobby_arrangement: "Lobby arrangement",
};

function prettyDate(value: string | null) {
  if (!value) return "Today";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function prettyTime(value: string | null) {
  if (!value) return "Time flexible";
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText || 0);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}
function amount(line: FlowerFulfillmentLine) {
  const value = Number.isInteger(line.quantity) ? line.quantity.toFixed(0) : line.quantity.toFixed(2).replace(/0$/, "");
  return `${value} ${line.unit.replace("bucket_equivalent", "bucket").replace(/_/g, " ")}`;
}

export default function FlowerFulfillmentFocusPage({ task }: { task: FlowerFulfillmentTask }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const returnTo = task.returnTo || (task.dueDate ? `/day?date=${encodeURIComponent(task.dueDate)}` : "/");

  async function submit() {
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/flower-fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          note: note.trim() || null,
          idempotencyKey: `flower-fulfillment:${task.id}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Fulfillment result failed.");
      setMessage("Fulfilled recorded. Atlas now has an actual handoff fact for this order.");
      window.setTimeout(() => window.location.assign(returnTo), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fulfillment result failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href={returnTo} className={styles.brand}><small>Atlas</small><strong>Fulfill</strong></Link>
        <Link href={returnTo} className={styles.close} aria-label="Close flower fulfillment">×</Link>
      </header>
      <div className={styles.body}>
        <article className={styles.ticket}>
          <section className={styles.hero}>
            <div className={styles.kicker}><span>Committed flower order</span><span>{prettyDate(task.fulfillmentDueDate || task.dueDate)}</span></div>
            <h1>{task.customerLabel}</h1>
            <p>{task.fulfillmentMode === "delivery" ? "Delivery" : "Pickup"} · {prettyTime(task.fulfillmentDueTime)}</p>
          </section>

          <section className={styles.facts} aria-label="Order facts">
            <div className={styles.fact}><small>Channel</small><strong>{task.salesChannel.replace(/_/g, " ")}</strong></div>
            <div className={styles.fact}><small>Order total</small><strong>${task.totalAmount.toFixed(2)}</strong></div>
            {task.eventKey ? <div className={`${styles.fact} ${styles.factWide}`}><small>Event / sale source</small><strong>{task.eventKey}</strong></div> : null}
          </section>

          <section className={styles.prompt}>
            <small>Sold → Going out → Fulfilled</small>
            <h2>Were these flowers actually handed off?</h2>
            <p>The order, due date, and this task prove commitment only. Record Fulfilled only after the customer actually receives the flowers.</p>
          </section>

          <section className={styles.form}>
            <div>
              {task.lines.map((line) => (
                <div className={styles.fact} key={line.id}>
                  <small>{KIND_LABELS[line.inventoryKind] ?? line.inventoryKind}</small>
                  <strong>{amount(line)} · ${line.lineTotal.toFixed(2)}</strong>
                </div>
              ))}
            </div>
            {task.note ? <p className={styles.message}>Order note: {task.note}</p> : null}
            <label><span>Handoff note (optional)</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Where it was left, who received it, or anything important about the handoff." /></label>
            <button type="button" className={styles.submit} disabled={saving} onClick={() => void submit()}>{saving ? "Recording…" : "Record fulfilled"}</button>
            {message ? <p className={styles.message}>{message}</p> : null}
          </section>
        </article>
      </div>
    </main>
  );
}
