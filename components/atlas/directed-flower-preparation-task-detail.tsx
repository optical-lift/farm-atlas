"use client";

import { useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import styles from "./directed-flower-preparation-task-detail.module.css";

export type DirectedPreparationLine = {
  id: string;
  lineNumber: number;
  productLabel: string;
  outputKind: "bundle" | "posy" | "bouquet" | "lobby_arrangement";
  requestedQuantity: number;
  stemsPerUnit: number | null;
  note: string | null;
};

export type DirectedPreparationTask = {
  id: string;
  dueDate: string | null;
  harvestDate: string;
  directiveId: string;
  directiveLines: DirectedPreparationLine[];
  returnTo?: string | null;
};

function instruction(line: DirectedPreparationLine) {
  if (line.outputKind === "bundle") return `${line.stemsPerUnit ?? "?"}-stem bunches`;
  if (line.outputKind === "lobby_arrangement") return "arrangements";
  return `${line.outputKind}s`;
}

export default function DirectedFlowerPreparationTaskDetail({ task }: { task: DirectedPreparationTask }) {
  const initialActuals = useMemo(
    () => Object.fromEntries(task.directiveLines.map((line) => [line.id, line.requestedQuantity])) as Record<string, number>,
    [task.directiveLines],
  );
  const [actuals, setActuals] = useState<Record<string, number>>(initialActuals);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [remainders, setRemainders] = useState<Record<string, number | null>>({});
  const [remainingOpen, setRemainingOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const returnTo = task.returnTo || (task.dueDate ? `/day?date=${encodeURIComponent(task.dueDate)}` : "/");

  function changeActual(id: string, delta: number) {
    setActuals((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) + delta) }));
    setMessage(null);
  }

  function changeRemainder(product: string, delta: number) {
    setRemainders((current) => {
      const currentValue = current[product];
      return { ...current, [product]: Math.max(0, (currentValue ?? 0) + delta) };
    });
    setMessage(null);
  }

  async function submit() {
    try {
      setSaving(true);
      setMessage(null);
      const lineResults = task.directiveLines.map((line) => ({
        directiveLineId: line.id,
        lineNumber: line.lineNumber,
        productLabel: line.productLabel,
        outputKind: line.outputKind,
        stemsPerUnit: line.stemsPerUnit,
        requestedQuantity: line.requestedQuantity,
        actualQuantity: actuals[line.id] ?? 0,
        note: notes[line.id]?.trim() || null,
      }));
      const remainingStems = task.directiveLines.flatMap((line) => {
        const value = remainders[line.productLabel];
        return value == null ? [] : [{ productLabel: line.productLabel, quantity: value, source: "worker_count" }];
      });

      const response = await fetch("/api/atlas/task-transition", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-atlas-intent": "task-transition-v1",
        },
        body: JSON.stringify({
          taskId: task.id,
          transition: "done",
          idempotencyKey: `flower-preparation-final-tally:v1:${task.id}:${Date.now()}`,
          payload: {
            structuredResultKind: "flower_preparation_directive_final_tally_v1",
            flowerPreparationDirectiveId: task.directiveId,
            requestedOutputTruthBoundary: "owner_requested_preparation",
            actualOutputTruthBoundary: "worker_confirmed_preparation",
            lines: lineResults,
            remainingStems,
          },
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Final tally could not be recorded.");
      window.location.assign(returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Final tally could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <AtlasTaskCardFrame
        family="Harvest"
        familyDetail="sellable"
        title="Condition + Bunch"
        subtitle="Today’s pre-sale flowers · Elm Farm"
        timing="Condition + bundle for pre-sales"
        completion={
          <div className={styles.completion}>
            <button type="button" disabled={saving} onClick={() => void submit()}>{saving ? "Recording…" : "Flowers are ready"}</button>
            {message ? <p>{message}</p> : null}
          </div>
        }
      >
        <div className={styles.trail} aria-label="Harvest to delivery trail">
          <span className={styles.trailDone}><b>Harvested</b><small>complete</small></span>
          <span className={styles.trailNow}><b>Condition + bunch</b><small>you are here</small></span>
          <span className={styles.trailLocked}><b>Deliver</b><small>next task</small></span>
        </div>

        <section className={styles.instructions}>
          <header><div><span>Orders</span><strong>Record final tally</strong></div><small>Sellable</small></header>
          <div className={styles.prepList}>
            {task.directiveLines.map((line) => (
              <article className={styles.prepRow} key={line.id}>
                <div className={styles.identity}>
                  <strong>{line.productLabel}</strong>
                  <small>{instruction(line)}</small>
                  {line.note ? <em>{line.note}</em> : null}
                </div>
                <div className={styles.target}><span>QTY</span><strong>{line.requestedQuantity}</strong></div>
                <div className={styles.actual}>
                  <span>Made</span>
                  <div className={styles.stepper}>
                    <button type="button" disabled={saving || (actuals[line.id] ?? 0) === 0} onClick={() => changeActual(line.id, -1)}>−</button>
                    <strong>{actuals[line.id] ?? 0}</strong>
                    <button type="button" disabled={saving} onClick={() => changeActual(line.id, 1)}>+</button>
                  </div>
                </div>
                <details className={styles.noteDrawer}>
                  <summary>Note (optional)</summary>
                  <label><span>Note (optional)</span><input value={notes[line.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [line.id]: event.target.value }))} /></label>
                </details>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.remainingSection}>
          <div className={styles.remainingLaunch}>
            <div className={styles.remainingHeadCopy}>
              <span className={styles.remainingKicker}>Remaining stems</span>
              <strong>Count only where Atlas cannot calculate yet</strong>
            </div>
            <button type="button" aria-expanded={remainingOpen} onClick={() => setRemainingOpen((current) => !current)}>
              {remainingOpen ? "Hide remaining stems" : "Log remaining stems"}
            </button>
          </div>
          {remainingOpen ? (
            <div className={styles.remainingList}>
              {task.directiveLines.map((line) => {
                const value = remainders[line.productLabel];
                return (
                  <div className={styles.remainingRow} key={line.id}>
                    <div className={styles.remainingIdentity}><strong>{line.productLabel}</strong><small>Count needed for this harvest</small></div>
                    <div className={styles.remainingControl}>
                      <span>Count</span>
                      <div className={styles.stepper}>
                        <button type="button" disabled={saving || (value ?? 0) === 0} onClick={() => changeRemainder(line.productLabel, -1)}>−</button>
                        <strong>{value == null ? "—" : value}</strong>
                        <button type="button" disabled={saving} onClick={() => changeRemainder(line.productLabel, 1)}>+</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      </AtlasTaskCardFrame>
    </main>
  );
}
