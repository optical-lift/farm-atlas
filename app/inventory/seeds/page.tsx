"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "./seed-inventory.module.css";

type Dependency = {
  allocationId: string;
  productionLotId: string;
  productionLotLabel: string;
  plannedSowDate: string | null;
  allocatedQuantity: number | string;
  outstandingQuantity: number | string;
  coveredByTrustedInventory: boolean;
  blockingReason: string | null;
};

type Rhythm = {
  stateId: string;
  state: string;
  warningAt: string | null;
  dueAt: string | null;
  failureAt: string | null;
  currentTaskId: string | null;
  bindingActive: boolean;
};

type SeedLot = {
  seedLotId: string;
  stableKey: string;
  lotLabel: string;
  cropLabel: string;
  variety: string | null;
  supplier: string | null;
  storageLocation: string | null;
  seedLotStatus: string;
  recordedReceiptQuantity: number | string;
  quantityUnit: string;
  observationStatus: string;
  verifiedOnHandQuantity: number | string | null;
  projectedOnHandQuantity: number | string | null;
  outstandingReservedQuantity: number | string;
  projectedUnreservedQuantity: number | string | null;
  lastVerifiedAt: string | null;
  lastObservedAt: string | null;
  countTrusted: boolean;
  lowStockThreshold: number | string | null;
  atOrBelowLowStockThreshold: boolean;
  stateNote: string | null;
  rhythm: Rhythm | null;
  dependencies: Dependency[];
  eventCount: number;
};

type Dashboard = {
  ok?: boolean;
  error?: string;
  farmId?: string;
  canManage?: boolean;
  items?: SeedLot[];
};

type Draft = {
  cadenceDays: string;
  warningDays: string;
  graceDays: string;
  firstCheckDate: string;
  lowStockThreshold: string;
  reason: string;
};

const blankDraft: Draft = {
  cadenceDays: "",
  warningDays: "",
  graceDays: "",
  firstCheckDate: "",
  lowStockThreshold: "",
  reason: "",
};

function numberLabel(value: number | string | null, unit: string) {
  if (value === null || value === undefined || value === "") return "Unknown";
  const number = Number(value);
  return `${Number.isFinite(number) ? number.toLocaleString() : value} ${unit}`;
}

function prettyDate(value: string | null) {
  if (!value) return "Never physically counted";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusLabel(item: SeedLot) {
  if (item.countTrusted) return item.atOrBelowLowStockThreshold ? "Verified · low" : "Verified";
  if (item.observationStatus === "problem") return "Problem recorded";
  if (item.observationStatus === "uncertain") return "Unverified";
  if (item.observationStatus === "depleted") return "Verified at zero";
  if (item.observationStatus === "retired") return "Retired";
  return item.rhythm ? "First count pending" : "Not configured";
}

function rhythmTruth(item: SeedLot) {
  if (!item.rhythm) return "The imported quantity is historical inventory information, not a dated physical count. Configure a first recount before dependent sowing work relies on it.";
  if (item.countTrusted) return `The current physical count is trusted through the Clock. Last verified ${prettyDate(item.lastVerifiedAt)}.`;
  if (item.rhythm.state === "recovering") return "The current recount remains unresolved. Atlas will not treat the stored quantity as trusted until a physical result is recorded.";
  return "A physical count is required. Time opened the obligation but did not decide how many seeds are present.";
}

function ConfigForm({ item, onSaved }: { item: SeedLot; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function patch(key: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/seed-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "configure",
          seedLotId: item.seedLotId,
          cadenceDays: draft.cadenceDays,
          warningDays: draft.warningDays,
          graceDays: draft.graceDays,
          firstCheckDate: draft.firstCheckDate,
          lowStockThreshold: draft.lowStockThreshold || null,
          reason: draft.reason,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Freshness rule failed.");
      setMessage("First count and freshness rule recorded.");
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Freshness rule failed.");
    } finally {
      setSaving(false);
    }
  }

  const complete = Boolean(
    draft.cadenceDays.trim()
    && draft.warningDays.trim()
    && draft.graceDays.trim()
    && draft.firstCheckDate
    && draft.reason.trim(),
  );

  return (
    <details className={styles.configure}>
      <summary>Set the first count + freshness rule</summary>
      <div className={styles.form}>
        <label><span>Count stays trusted for days</span><input inputMode="numeric" value={draft.cadenceDays} onChange={(event) => patch("cadenceDays", event.target.value)} placeholder="Owner chooses" /></label>
        <label><span>Warning days before expiry</span><input inputMode="numeric" value={draft.warningDays} onChange={(event) => patch("warningDays", event.target.value)} placeholder="Owner chooses" /></label>
        <label><span>Grace days after expiry</span><input inputMode="numeric" value={draft.graceDays} onChange={(event) => patch("graceDays", event.target.value)} placeholder="Owner chooses" /></label>
        <label><span>First physical count</span><input type="date" value={draft.firstCheckDate} onChange={(event) => patch("firstCheckDate", event.target.value)} /></label>
        <label data-wide="true"><span>Low-stock threshold (optional)</span><input inputMode="decimal" value={draft.lowStockThreshold} onChange={(event) => patch("lowStockThreshold", event.target.value)} placeholder={`No automatic purchase task · ${item.quantityUnit}`} /></label>
        <label data-wide="true"><span>Why this lifespan is right</span><textarea rows={3} value={draft.reason} onChange={(event) => patch("reason", event.target.value)} placeholder="Record the Owner rule, not a guess from Atlas." /></label>
        <button type="button" disabled={saving || !complete} onClick={() => void submit()}>{saving ? "Saving…" : "Activate first count"}</button>
        {message ? <p className={styles.message}>{message}</p> : null}
      </div>
    </details>
  );
}

export default function SeedInventoryPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/atlas/seed-inventory", { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json() as Dashboard;
      if (!response.ok || !data.ok) throw new Error(data.error || "Seed inventory failed.");
      setDashboard(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Seed inventory failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href="/more" className={styles.brand}><small>Atlas</small><strong>Seed Inventory</strong></Link>
        <Link href="/more" className={styles.close} aria-label="Close seed inventory">×</Link>
      </header>

      <div className={styles.body}>
        <section className={styles.intro}>
          <small>Physical stock + crop commitments</small>
          <h1>Seed Inventory</h1>
          <p>Receipt quantity is history. Verified on-hand quantity is current physical evidence. Time can make a count stale, but it never changes the number.</p>
        </section>

        {loading ? <div className={styles.notice}>Loading seed inventory.</div> : null}
        {error ? <div className={styles.notice}>{error}</div> : null}
        {!loading && !error && !(dashboard?.items?.length) ? <div className={styles.notice}>No canonical seed lots are recorded for this farm.</div> : null}

        <section className={styles.list} aria-label="Seed lots">
          {(dashboard?.items ?? []).map((item) => (
            <article className={styles.card} key={item.seedLotId}>
              <header className={styles.cardHead}>
                <div>
                  <small>{item.cropLabel}{item.variety ? ` · ${item.variety}` : ""}</small>
                  <h2>{item.lotLabel}</h2>
                  <p>{item.storageLocation || "Storage location not recorded"}</p>
                </div>
                <span className={styles.status} data-trusted={item.countTrusted}>{statusLabel(item)}</span>
              </header>

              <section className={styles.metrics} aria-label={`${item.lotLabel} quantities`}>
                <div className={styles.metric}><strong>{numberLabel(item.recordedReceiptQuantity, item.quantityUnit)}</strong><span>recorded receipt</span></div>
                <div className={styles.metric}><strong>{numberLabel(item.projectedOnHandQuantity, item.quantityUnit)}</strong><span>verified projected on hand</span></div>
                <div className={styles.metric}><strong>{numberLabel(item.outstandingReservedQuantity, item.quantityUnit)}</strong><span>committed to production</span></div>
              </section>

              <div className={styles.truth}>{rhythmTruth(item)}</div>

              <section className={styles.dependencies}>
                <h3>Dependent production lots</h3>
                {item.dependencies.length ? item.dependencies.map((dependency) => (
                  <div className={styles.dependency} key={dependency.allocationId}>
                    <div>
                      <strong>{dependency.productionLotLabel}</strong>
                      <span>Sow {prettyDate(dependency.plannedSowDate)} · {numberLabel(dependency.outstandingQuantity, item.quantityUnit)} reserved</span>
                      {dependency.blockingReason ? <em>{dependency.blockingReason}</em> : null}
                    </div>
                    <b>{dependency.coveredByTrustedInventory ? "Covered" : "Not trusted"}</b>
                  </div>
                )) : <p className={styles.message}>No active production commitments.</p>}
              </section>

              {item.rhythm?.currentTaskId ? (
                <Link className={styles.taskLink} href={`/task-focus/${encodeURIComponent(item.rhythm.currentTaskId)}?returnTo=${encodeURIComponent("/inventory/seeds")}`}>
                  <span>Open physical recount</span><b aria-hidden="true">›</b>
                </Link>
              ) : null}

              {dashboard?.canManage && !item.rhythm ? <ConfigForm item={item} onSaved={load} /> : null}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
