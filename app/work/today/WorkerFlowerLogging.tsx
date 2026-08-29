"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./work.module.css";

type CropOption = {
  cropCycleId: string;
  cropLabel: string;
  variety: string | null;
  objectLabel: string;
};
type HarvestBatch = { id: string; harvestDate: string; createdAt: string; summary: string };
type LoggedItem = { id: string; kind: string; at: string; label: string; detail: string; source: string };
type WorkerFlowerContext = {
  ok?: boolean;
  error?: string | { message?: string };
  asOf?: string;
  farm?: { id: string; name: string };
  cropOptions?: CropOption[];
  harvestBatches?: HarvestBatch[];
  loggedToday?: LoggedItem[];
};
type HarvestDraft = {
  id: string;
  cropCycleId: string;
  bucketHalves: number;
  moreAvailability: "yes" | "unsure" | "no";
};
type PrepDraft = {
  id: string;
  productLabel: string;
  kind: "bundle" | "posy" | "bouquet" | "conditioned_bucket";
  quantity: string;
  stemsPerUnit: string;
};

function errorMessage(error: WorkerFlowerContext["error"], fallback: string) {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function prettyTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

function halfBucketLabel(halves: number) {
  if (!halves) return "0";
  const whole = Math.floor(halves / 2);
  const half = halves % 2;
  if (!whole && half) return "½ bucket";
  if (whole === 1 && !half) return "1 bucket";
  return `${whole}${half ? "½" : ""} buckets`;
}

export default function WorkerFlowerLogging() {
  const [context, setContext] = useState<WorkerFlowerContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"harvest" | "prepare" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rowCounter = useRef(2);
  const harvestKey = useRef<string | null>(null);
  const prepKey = useRef<string | null>(null);

  const [harvestRows, setHarvestRows] = useState<HarvestDraft[]>([
    { id: "worker-harvest-1", cropCycleId: "", bucketHalves: 0, moreAvailability: "yes" },
  ]);
  const [harvestNote, setHarvestNote] = useState("");
  const [harvestBatchId, setHarvestBatchId] = useState("");
  const [prepRows, setPrepRows] = useState<PrepDraft[]>([
    { id: "worker-prep-1", productLabel: "", kind: "bundle", quantity: "1", stemsPerUnit: "5" },
  ]);
  const [prepNote, setPrepNote] = useState("");

  const nextId = (prefix: string) => `${prefix}-${++rowCounter.current}`;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/atlas/worker-flower-log", { cache: "no-store" });
      const payload = await response.json() as WorkerFlowerContext;
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload.error, "Flower logging could not be loaded."));
      setContext(payload);
      setHarvestBatchId((current) => current || payload.harvestBatches?.[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Flower logging could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submitHarvest() {
    const farmId = context?.farm?.id;
    if (!farmId) return;
    const rows = harvestRows.filter((row) => row.cropCycleId && row.bucketHalves > 0);
    if (!rows.length) {
      setMessage("Choose a flower crop and record how much you cut.");
      return;
    }
    const key = harvestKey.current ?? `worker-flower-harvest:${crypto.randomUUID()}`;
    harvestKey.current = key;
    try {
      setSaving("harvest");
      setMessage(null);
      const response = await fetch("/api/atlas/harvest-workbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "harvest", farmId, rows, note: harvestNote.trim() || null, idempotencyKey: key }),
      });
      const payload = await response.json() as WorkerFlowerContext;
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload.error, "The harvest could not be logged."));
      setHarvestRows([{ id: nextId("worker-harvest"), cropCycleId: "", bucketHalves: 0, moreAvailability: "yes" }]);
      setHarvestNote("");
      harvestKey.current = null;
      setMessage("Extra harvest logged. It is now in the same flower history as task harvests.");
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The harvest could not be logged.");
    } finally {
      setSaving(null);
    }
  }

  async function submitPreparation() {
    const farmId = context?.farm?.id;
    if (!farmId || !harvestBatchId) {
      setMessage("Choose the harvest batch these flowers came from.");
      return;
    }
    const outputs = prepRows.map((row) => ({
      kind: row.kind,
      productLabel: row.productLabel.trim(),
      quantity: Number(row.quantity),
      stemsPerUnit: row.kind === "bundle" ? Number(row.stemsPerUnit) : null,
    }));
    if (outputs.some((row) => !row.productLabel || !Number.isFinite(row.quantity) || row.quantity <= 0 || (row.kind === "bundle" && (!Number.isInteger(row.stemsPerUnit) || Number(row.stemsPerUnit) < 1)))) {
      setMessage("Each finished line needs a flower, quantity, and stems per bunch when it is a bunch.");
      return;
    }
    const key = prepKey.current ?? `worker-flower-prep:${crypto.randomUUID()}`;
    prepKey.current = key;
    try {
      setSaving("prepare");
      setMessage(null);
      const response = await fetch("/api/atlas/harvest-workbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", farmId, harvestBatchId, outputs, note: prepNote.trim() || null, idempotencyKey: key }),
      });
      const payload = await response.json() as WorkerFlowerContext;
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload.error, "The prep batch could not be logged."));
      setPrepRows([{ id: nextId("worker-prep"), productLabel: "", kind: "bundle", quantity: "1", stemsPerUnit: "5" }]);
      setPrepNote("");
      prepKey.current = null;
      setMessage("Extra prep batch logged. Those finished flowers are now in Ready inventory.");
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The prep batch could not be logged.");
    } finally {
      setSaving(null);
    }
  }

  if (error && !context) {
    return (
      <section className={styles.flowerLog} data-worker-flower-log="farm-hand-only">
        <div className={styles.flowerLogHeader}><div><h2>Flower logging</h2><p>Extra flower work that was not already on a task.</p></div></div>
        <p className={styles.error}>{error}</p>
        <button className={styles.flowerRetry} type="button" onClick={() => void load()}>Try again</button>
      </section>
    );
  }

  return (
    <section className={styles.flowerLog} data-worker-flower-log="farm-hand-only">
      <div className={styles.flowerLogHeader}>
        <div>
          <h2>Flower logging</h2>
          <p>Use this only for extra flower work that was not already on a task. If it has a task card, finish the task instead.</p>
        </div>
        {loading ? <span>Updating…</span> : null}
      </div>

      {message ? <div className={styles.flowerMessage}><span>{message}</span><button type="button" onClick={() => setMessage(null)}>×</button></div> : null}

      <div className={styles.flowerQuickActions}>
        <details className={styles.flowerQuickCard}>
          <summary><span>Log another harvest</span><small>Extra cut</small></summary>
          <div className={styles.flowerForm}>
            {harvestRows.map((row, index) => (
              <div className={styles.flowerHarvestRow} key={row.id}>
                <label>
                  <span>{index ? "Another crop" : "What did you cut?"}</span>
                  <select value={row.cropCycleId} onChange={(event) => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, cropCycleId: event.target.value } : item)); }}>
                    <option value="">Choose crop + bed</option>
                    {(context?.cropOptions ?? []).map((crop) => <option key={crop.cropCycleId} value={crop.cropCycleId}>{crop.objectLabel} · {crop.cropLabel}{crop.variety ? ` · ${crop.variety}` : ""}</option>)}
                  </select>
                </label>
                <div className={styles.flowerCounter}>
                  <button type="button" aria-label="Remove half bucket" onClick={() => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, bucketHalves: Math.max(0, item.bucketHalves - 1) } : item)); }}>−</button>
                  <strong>{halfBucketLabel(row.bucketHalves)}</strong>
                  <button type="button" aria-label="Add half bucket" onClick={() => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, bucketHalves: Math.min(40, item.bucketHalves + 1) } : item)); }}>+</button>
                </div>
                <div className={styles.flowerChoice}>
                  <span>More still out there?</span>
                  {(["yes", "unsure", "no"] as const).map((value) => <button type="button" key={value} data-selected={row.moreAvailability === value ? "true" : "false"} onClick={() => { harvestKey.current = null; setHarvestRows((current) => current.map((item) => item.id === row.id ? { ...item, moreAvailability: value } : item)); }}>{value === "yes" ? "Yes" : value === "no" ? "No" : "Not sure"}</button>)}
                </div>
                {harvestRows.length > 1 ? <button className={styles.flowerTextButton} type="button" onClick={() => setHarvestRows((current) => current.filter((item) => item.id !== row.id))}>Remove crop</button> : null}
              </div>
            ))}
            <button className={styles.flowerAddButton} type="button" onClick={() => setHarvestRows((current) => [...current, { id: nextId("worker-harvest"), cropCycleId: "", bucketHalves: 0, moreAvailability: "yes" }])}>+ Add another crop</button>
            <label><span>Field note <small>optional</small></span><input value={harvestNote} onChange={(event) => { harvestKey.current = null; setHarvestNote(event.target.value); }} placeholder="Anything useful about this cut" /></label>
            <button className={styles.flowerPrimary} type="button" disabled={saving !== null} onClick={() => void submitHarvest()}>{saving === "harvest" ? "Logging…" : "Log harvest"}</button>
          </div>
        </details>

        <details className={styles.flowerQuickCard}>
          <summary><span>Log another prep batch</span><small>Extra finished flowers</small></summary>
          <div className={styles.flowerForm}>
            <label>
              <span>Which harvest did these come from?</span>
              <select value={harvestBatchId} onChange={(event) => { prepKey.current = null; setHarvestBatchId(event.target.value); }}>
                <option value="">Choose harvest batch</option>
                {(context?.harvestBatches ?? []).map((batch) => <option value={batch.id} key={batch.id}>{prettyDate(batch.harvestDate)} · {batch.summary}</option>)}
              </select>
            </label>
            {prepRows.map((row, index) => (
              <div className={styles.flowerPrepRow} key={row.id}>
                <strong>{index + 1}</strong>
                <input aria-label="Flower" placeholder="Sunflower" value={row.productLabel} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, productLabel: event.target.value } : item)); }} />
                <select aria-label="Finished form" value={row.kind} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, kind: event.target.value as PrepDraft["kind"] } : item)); }}>
                  <option value="bundle">Bunch</option>
                  <option value="posy">Posy</option>
                  <option value="bouquet">Bouquet</option>
                  <option value="conditioned_bucket">DIY bucket</option>
                </select>
                <input aria-label="Quantity" type="number" min="0" step={row.kind === "conditioned_bucket" ? ".25" : "1"} value={row.quantity} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, quantity: event.target.value } : item)); }} />
                {row.kind === "bundle" ? <label className={styles.flowerStems}><input aria-label="Stems each" type="number" min="1" value={row.stemsPerUnit} onChange={(event) => { prepKey.current = null; setPrepRows((current) => current.map((item) => item.id === row.id ? { ...item, stemsPerUnit: event.target.value } : item)); }} /><small>stems</small></label> : null}
                {prepRows.length > 1 ? <button className={styles.flowerRemoveButton} type="button" onClick={() => setPrepRows((current) => current.filter((item) => item.id !== row.id))}>×</button> : null}
              </div>
            ))}
            <button className={styles.flowerAddButton} type="button" onClick={() => setPrepRows((current) => [...current, { id: nextId("worker-prep"), productLabel: "", kind: "bundle", quantity: "1", stemsPerUnit: "5" }])}>+ Add another finished line</button>
            <label><span>Prep note <small>optional</small></span><input value={prepNote} onChange={(event) => { prepKey.current = null; setPrepNote(event.target.value); }} placeholder="Anything useful about this batch" /></label>
            <button className={styles.flowerPrimary} type="button" disabled={saving !== null || !(context?.harvestBatches?.length)} onClick={() => void submitPreparation()}>{saving === "prepare" ? "Logging…" : "Log prep batch"}</button>
          </div>
        </details>
      </div>

      <div className={styles.flowerLoggedToday}>
        <div className={styles.flowerLoggedTitle}><h3>You logged today</h3><span>{context?.loggedToday?.length ?? 0}</span></div>
        {(context?.loggedToday?.length ?? 0) ? (
          <div className={styles.flowerLoggedList}>
            {context?.loggedToday?.map((item) => (
              <article key={item.id}>
                <div><strong>{item.label}</strong><span>{prettyTime(item.at)}</span></div>
                <p>{item.detail}</p>
                <small>{item.source}</small>
              </article>
            ))}
          </div>
        ) : <p className={styles.flowerEmpty}>Nothing recorded by you yet today.</p>}
      </div>
    </section>
  );
}
