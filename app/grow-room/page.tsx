"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  growRoomActionLabel,
  growRoomBatchTrail,
  isGrowRoomStructuralObject,
  type GrowRoomBatch,
  type GrowRoomState,
} from "@/lib/atlas/grow-room";
import styles from "./grow-room.module.css";

type GrowRoomResponse = {
  ok: boolean;
  growRoom?: GrowRoomState;
  error?: string;
};

type ActionResponse = {
  ok: boolean;
  error?: string;
};

function prettyDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function quantityLabel(batch: GrowRoomBatch) {
  const quantity = batch.currentQuantity ?? batch.viableSeedlings;
  if (quantity === null) return "Live count not recorded";
  return `${quantity.toLocaleString("en-US")} ${batch.currentUnit || "seedlings"}`;
}

function actionChoices(batch: GrowRoomBatch) {
  if (batch.status === "germination_pending") {
    return [
      { key: "stand_counted", label: "Record live stand", needsQuantity: true },
      { key: "germination_failed", label: "No germination", needsQuantity: false },
    ];
  }
  if (batch.status === "failed") {
    return [{ key: "replacement_requested", label: "Re-sow or replace", needsQuantity: false }];
  }
  if (batch.status === "pot_up_needed") {
    return [{ key: "pot_up_completed", label: "Pot-up complete", needsQuantity: true }];
  }
  if (batch.status === "hardening") {
    return [
      { key: "hardening_advanced", label: "Advance hardening", needsQuantity: false },
      { key: "ready_to_transplant", label: "Ready to plant", needsQuantity: false },
    ];
  }
  if (batch.status === "transplant_ready") return [];
  return [
    { key: "mark_pot_up_needed", label: "Needs pot-up", needsQuantity: false },
    { key: "hardening_started", label: "Start hardening", needsQuantity: false },
    { key: "ready_to_transplant", label: "Ready to plant", needsQuantity: false },
    { key: "count_adjusted", label: "Correct live count", needsQuantity: true },
  ];
}

export default function GrowRoomPage() {
  const [state, setState] = useState<GrowRoomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingBatchId, setSavingBatchId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<Record<string, string>>({});

  const loadRoom = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/atlas/grow-room", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json() as GrowRoomResponse;
      if (!response.ok || !data.ok || !data.growRoom) {
        throw new Error(data.error || "The Grow Room could not be loaded.");
      }
      setState(data.growRoom);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The Grow Room could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  const structuralObjects = useMemo(
    () => (state?.objects ?? []).filter(isGrowRoomStructuralObject),
    [state],
  );
  const looseObjects = useMemo(
    () => (state?.objects ?? []).filter((object) => !isGrowRoomStructuralObject(object)),
    [state],
  );
  const batchesByLocation = useMemo(() => {
    const result = new Map<string, GrowRoomBatch[]>();
    for (const batch of state?.batches ?? []) {
      const key = batch.locationObjectId ?? "unplaced";
      result.set(key, [...(result.get(key) ?? []), batch]);
    }
    return result;
  }, [state]);

  async function recordAction(batch: GrowRoomBatch, actionKey: string, needsQuantity: boolean) {
    const rawQuantity = counts[batch.batchId]?.trim() ?? "";
    const quantity = rawQuantity === "" ? null : Number(rawQuantity);
    if (needsQuantity && (quantity === null || !Number.isFinite(quantity) || quantity < 0)) {
      setError("Enter the current live plant count before recording this move.");
      return;
    }

    setSavingBatchId(batch.batchId);
    setError(null);
    try {
      const response = await fetch("/api/atlas/grow-room", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          batchId: batch.batchId,
          actionKey,
          idempotencyKey: `${batch.batchId}:${actionKey}:${crypto.randomUUID()}`,
          quantity,
          unit: quantity === null ? null : "seedlings",
          locationObjectId: locations[batch.batchId] || null,
          metadata: { sourceSurface: "grow_room_digital_room" },
        }),
      });
      const data = await response.json() as ActionResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "The Grow Room move was not saved.");
      await loadRoom();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The Grow Room move was not saved.");
    } finally {
      setSavingBatchId(null);
    }
  }

  function batchCard(batch: GrowRoomBatch) {
    const trail = growRoomBatchTrail(batch);
    const choices = actionChoices(batch);
    return (
      <article className={styles.batchCard} key={batch.batchId}>
        <div className={styles.batchHeading}>
          <div>
            <small>{batch.locationLabel || "Unplaced batch"}</small>
            <h3>{batch.cropLabel}{batch.variety ? ` · ${batch.variety}` : ""}</h3>
            <p>{batch.batchLabel} · {batch.trayCount} {batch.trayCount === 1 ? "tray/container" : "trays/containers"}</p>
          </div>
          <span className={batch.actionRequired ? styles.actionBadge : styles.stageBadge}>
            {batch.actionRequired ? growRoomActionLabel(batch.actionKey) : batch.status.replaceAll("_", " ")}
          </span>
        </div>

        <ol className={styles.trail} aria-label={`Green Trail for ${batch.batchLabel}`}>
          {trail.map((node) => (
            <li className={styles[node.state]} key={node.key} aria-current={node.state === "current" ? "step" : undefined}>
              <i aria-hidden="true" />
              <span>{node.label}</span>
            </li>
          ))}
        </ol>

        <div className={styles.batchFacts}>
          <span><small>Sown</small>{prettyDate(batch.sownDate)}</span>
          <span><small>Alive now</small>{quantityLabel(batch)}</span>
          <span><small>Plant window</small>{batch.expectedTransplantStart ? `${prettyDate(batch.expectedTransplantStart)}–${prettyDate(batch.expectedTransplantEnd)}` : "Not assigned"}</span>
          <span><small>Destination</small>{batch.destinationObjectId ? "Linked" : "Not linked"}</span>
        </div>

        {choices.length || structuralObjects.length ? (
          <div className={styles.batchControls}>
            {choices.some((choice) => choice.needsQuantity) ? (
              <label>
                Current live count
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={counts[batch.batchId] ?? ""}
                  onChange={(event) => setCounts((current) => ({ ...current, [batch.batchId]: event.target.value }))}
                  placeholder={batch.currentQuantity?.toString() || batch.viableSeedlings?.toString() || "0"}
                />
              </label>
            ) : null}
            {structuralObjects.length ? (
              <label>
                Shelf or room position
                <select
                  value={locations[batch.batchId] ?? batch.locationObjectId ?? ""}
                  onChange={(event) => setLocations((current) => ({ ...current, [batch.batchId]: event.target.value }))}
                >
                  <option value="">Leave location unchanged</option>
                  {structuralObjects.map((object) => <option key={object.objectId} value={object.objectId}>{object.label}</option>)}
                </select>
              </label>
            ) : null}
            <div className={styles.actionButtons}>
              {choices.map((choice) => (
                <button
                  type="button"
                  key={choice.key}
                  disabled={savingBatchId === batch.batchId}
                  onClick={() => void recordAction(batch, choice.key, choice.needsQuantity)}
                >
                  {choice.label}
                </button>
              ))}
              {structuralObjects.length && locations[batch.batchId] && locations[batch.batchId] !== batch.locationObjectId ? (
                <button
                  type="button"
                  disabled={savingBatchId === batch.batchId}
                  onClick={() => void recordAction(batch, "moved", false)}
                >
                  Move batch
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <main className={styles.shell}>
      <section className={styles.room}>
        <header className={styles.topbar}>
          <Link href="/" className={styles.brand}><small>Atlas</small><strong>Elm Farm</strong></Link>
          <Link href="/" className={styles.back}>← Today</Link>
        </header>

        <section className={styles.hero}>
          <div>
            <small>Digital room</small>
            <h1>{state?.zone?.label || "Grow Room"}</h1>
            <p>Preserve the green Trail of the plants that are actually alive.</p>
          </div>
          <div className={styles.metrics}>
            <span><strong>{state?.batches.length ?? 0}</strong> live batches</span>
            <span><strong>{state?.actions.length ?? 0}</strong> action steps</span>
            <span><strong>{batchesByLocation.get("unplaced")?.length ?? 0}</strong> unplaced</span>
          </div>
        </section>

        <p className={styles.careRule}>Ordinary watering happens during the room visit. Atlas does not ask Anna to click or log it.</p>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {loading ? <div className={styles.empty}>Opening the Grow Room…</div> : null}

        {!loading && state ? (
          <>
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div><small>Do while you are here</small><h2>Room actions</h2></div>
                <span>{state.actions.length}</span>
              </div>
              {state.actions.length ? (
                <div className={styles.actionList}>
                  {state.actions.map((action) => (
                    <Link href={`/task-focus/${encodeURIComponent(action.taskId)}?returnTo=${encodeURIComponent("/grow-room")}`} key={action.taskId}>
                      <span>{action.dueDate ? prettyDate(action.dueDate) : "Open"}</span>
                      <strong>{action.title}</strong>
                      <small>{action.batchLabel || action.zoneLabel || "Grow Room"}</small>
                    </Link>
                  ))}
                </div>
              ) : <div className={styles.empty}>No separate Grow Room action is currently due.</div>}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div><small>Physical room</small><h2>Shelves and live batches</h2></div>
                <span>{structuralObjects.length}</span>
              </div>

              {structuralObjects.map((object) => (
                <section className={styles.shelf} key={object.objectId}>
                  <div className={styles.shelfHeading}><strong>{object.label}</strong><small>{batchesByLocation.get(object.objectId)?.length ?? 0} batches</small></div>
                  {(batchesByLocation.get(object.objectId) ?? []).length
                    ? (batchesByLocation.get(object.objectId) ?? []).map(batchCard)
                    : <div className={styles.empty}>No verified living batch is placed here yet.</div>}
                </section>
              ))}

              {(batchesByLocation.get("unplaced") ?? []).length ? (
                <section className={styles.shelf}>
                  <div className={styles.shelfHeading}><strong>Unplaced living batches</strong><small>Place these during the next room round</small></div>
                  {(batchesByLocation.get("unplaced") ?? []).map(batchCard)}
                </section>
              ) : null}

              {!state.batches.length ? (
                <div className={styles.truthEmpty}>
                  <strong>No verified tray batches are entered yet.</strong>
                  <p>Planned sowings do not count as living plants. The first inventory will create the real batches and place them on real shelves.</p>
                </div>
              ) : null}
            </section>

            {looseObjects.length ? (
              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div><small>Existing records</small><h2>Known plants and containers</h2></div>
                  <span>{looseObjects.length}</span>
                </div>
                <div className={styles.knownGrid}>
                  {looseObjects.map((object) => (
                    <article key={object.objectId}>
                      <strong>{object.label}</strong>
                      <span>{object.objectType.replaceAll("_", " ")}</span>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
