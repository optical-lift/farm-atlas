"use client";

import { useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import {
  FLOWER_BUNDLE_STEM_COUNTS,
  isCanonicalFlowerBundleStemCount,
} from "@/lib/atlas/flower-vocabulary";
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

type OutputKind = DirectedPreparationLine["outputKind"];

type WorkerAddedLine = {
  id: string;
  productLabel: string;
  outputKind: OutputKind;
  actualQuantity: number;
  stemsPerUnit: number | null;
};

export type DirectedPreparationTask = {
  id: string;
  dueDate: string | null;
  harvestDate: string;
  directiveId: string;
  directiveLines: DirectedPreparationLine[];
  returnTo?: string | null;
};

const outputChoices: Array<{ value: OutputKind; label: string }> = [
  { value: "bundle", label: "Bundle" },
  { value: "posy", label: "Posy" },
  { value: "bouquet", label: "Bouquet" },
  { value: "lobby_arrangement", label: "Arrangement" },
];

const stemChoices = [...FLOWER_BUNDLE_STEM_COUNTS];

function instruction(line: Pick<DirectedPreparationLine, "outputKind" | "stemsPerUnit">) {
  if (line.outputKind === "bundle") return `${line.stemsPerUnit ?? "?"}-stem bundles`;
  if (line.outputKind === "lobby_arrangement") return "arrangements";
  return `${line.outputKind}s`;
}

function nonce() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function DirectedFlowerPreparationTaskDetail({ task }: { task: DirectedPreparationTask }) {
  const initialActuals = useMemo(
    () => Object.fromEntries(task.directiveLines.map((line) => [line.id, line.requestedQuantity])) as Record<string, number>,
    [task.directiveLines],
  );
  const [actuals, setActuals] = useState<Record<string, number>>(initialActuals);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [remainders, setRemainders] = useState<Record<string, number | null>>({});
  const [remainingOpen, setRemainingOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraLines, setExtraLines] = useState<WorkerAddedLine[]>([]);
  const [productDraft, setProductDraft] = useState("");
  const [outputDraft, setOutputDraft] = useState<OutputKind>("bundle");
  const [stemsDraft, setStemsDraft] = useState<number>(5);
  const [quantityDraft, setQuantityDraft] = useState(1);
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

  function changeExtraQuantity(id: string, delta: number) {
    setExtraLines((current) => current.map((line) => line.id === id
      ? { ...line, actualQuantity: Math.max(0, line.actualQuantity + delta) }
      : line));
    setMessage(null);
  }

  function addExtraLine() {
    const productLabel = productDraft.trim();
    if (!productLabel || quantityDraft < 1 || (outputDraft === "bundle" && !isCanonicalFlowerBundleStemCount(stemsDraft))) return;
    setExtraLines((current) => [...current, {
      id: nonce(),
      productLabel,
      outputKind: outputDraft,
      actualQuantity: quantityDraft,
      stemsPerUnit: outputDraft === "bundle" ? stemsDraft : null,
    }]);
    setProductDraft("");
    setOutputDraft("bundle");
    setStemsDraft(5);
    setQuantityDraft(1);
    setExtraOpen(false);
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
      const workerAddedLines = extraLines
        .filter((line) => line.actualQuantity > 0)
        .map((line, index) => ({
          lineNumber: task.directiveLines.length + index + 1,
          productLabel: line.productLabel,
          outputKind: line.outputKind,
          stemsPerUnit: line.stemsPerUnit,
          actualQuantity: line.actualQuantity,
          source: "worker_added_actual",
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
            workerAddedLines,
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

  const extraSentence = productDraft.trim()
    ? `${quantityDraft} ${instruction({ outputKind: outputDraft, stemsPerUnit: outputDraft === "bundle" ? stemsDraft : null })} · ${productDraft.trim()}`
    : "Build the extra flower tally";

  return (
    <main className={styles.shell}>
      <AtlasTaskCardFrame
        family="Harvest"
        familyDetail="sellable"
        title="Condition + Bundle"
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
          <span className={styles.trailNow}><b>Condition + bundle</b><small>you are here</small></span>
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

            {extraLines.map((line) => (
              <article className={`${styles.prepRow} ${styles.extraRow}`} key={line.id}>
                <div className={styles.identity}>
                  <strong>{line.productLabel}</strong>
                  <small>{instruction(line)}</small>
                  <em>Added to final tally</em>
                  <button type="button" className={styles.removeExtra} disabled={saving} onClick={() => setExtraLines((current) => current.filter((candidate) => candidate.id !== line.id))}>Remove</button>
                </div>
                <div className={styles.target}><span>QTY</span><strong>—</strong></div>
                <div className={styles.actual}>
                  <span>Made</span>
                  <div className={styles.stepper}>
                    <button type="button" disabled={saving || line.actualQuantity === 0} onClick={() => changeExtraQuantity(line.id, -1)}>−</button>
                    <strong>{line.actualQuantity}</strong>
                    <button type="button" disabled={saving} onClick={() => changeExtraQuantity(line.id, 1)}>+</button>
                  </div>
                </div>
              </article>
            ))}

            <div className={styles.addArea}>
              <button type="button" className={styles.addLaunch} aria-expanded={extraOpen} disabled={saving} onClick={() => setExtraOpen((current) => !current)}>
                Add +
              </button>
              {extraOpen ? (
                <div className={styles.extraBuilder}>
                  <div className="atlas-log-sentence">{extraSentence}</div>

                  <label className={styles.extraField}>
                    <span>Flower</span>
                    <input value={productDraft} onChange={(event) => { setProductDraft(event.target.value); setMessage(null); }} placeholder="Flower or variety" maxLength={160} />
                  </label>

                  <div className={styles.extraStep}>
                    <span>Pack as</span>
                    <div className="atlas-log-chip-grid compact expanded">
                      {outputChoices.map((choice) => (
                        <button type="button" className={outputDraft === choice.value ? "selected" : ""} key={choice.value} onClick={() => setOutputDraft(choice.value)}>
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {outputDraft === "bundle" ? (
                    <div className={styles.extraStep}>
                      <span>Stems per bundle</span>
                      <div className="atlas-log-chip-grid compact expanded">
                        {stemChoices.map((choice) => (
                          <button type="button" className={stemsDraft === choice ? "selected" : ""} key={choice} onClick={() => setStemsDraft(choice)}>
                            {choice} stems
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className={styles.extraCountRow}>
                    <span>How many made?</span>
                    <div className={styles.stepper}>
                      <button type="button" disabled={quantityDraft <= 1} onClick={() => setQuantityDraft((current) => Math.max(1, current - 1))}>−</button>
                      <strong>{quantityDraft}</strong>
                      <button type="button" onClick={() => setQuantityDraft((current) => Math.min(10000, current + 1))}>+</button>
                    </div>
                  </div>

                  <div className={styles.extraActions}>
                    <button type="button" className={styles.cancelExtra} onClick={() => setExtraOpen(false)}>Cancel</button>
                    <button type="button" className={styles.saveExtra} disabled={!productDraft.trim()} onClick={addExtraLine}>Add to tally</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className={styles.remainingSection}>
          <div className={styles.remainingLaunch}>
            <div className={styles.remainingHeadCopy}>
              <span className={styles.remainingKicker}>Remaining stems</span>
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
