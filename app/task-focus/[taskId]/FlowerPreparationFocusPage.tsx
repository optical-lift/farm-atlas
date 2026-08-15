"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import styles from "./HarvestFocus.module.css";

export type FlowerPreparationInput = {
  id: string;
  cropLabel: string;
  variety: string | null;
  observedDate: string;
  bucketEquivalentFloor: number;
  lowerBound: boolean;
};

export type FlowerPreparationTask = {
  id: string;
  dueDate: string | null;
  harvestDate: string;
  inputs: FlowerPreparationInput[];
  returnTo?: string | null;
};

type ReadyKind = "conditioned_bucket" | "counted_stems" | "posy" | "bouquet" | "lobby_arrangement";

type DraftOutput = {
  id: string;
  kind: ReadyKind;
  quantity: string;
  lowerBound: boolean;
};

const READY_CHOICES: Array<{ key: ReadyKind; label: string; detail: string; unit: string }> = [
  { key: "conditioned_bucket", label: "Conditioned flowers", detail: "Loose flowers are handled and saleable by bucket", unit: "bucket" },
  { key: "counted_stems", label: "Counted stems", detail: "Use only when the sale unit really requires stem count", unit: "stems" },
  { key: "posy", label: "Posy", detail: "Finished small hand-tied product", unit: "posies" },
  { key: "bouquet", label: "Bouquet", detail: "Finished bouquet product", unit: "bouquets" },
  { key: "lobby_arrangement", label: "Lobby arrangement", detail: "Finished arrangement ready for placement or sale", unit: "arrangements" },
];

function prettyDate(value: string | null) {
  if (!value) return "Today";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function amountLabel(input: FlowerPreparationInput) {
  const rounded = Math.round(input.bucketEquivalentFloor * 100) / 100;
  const amount = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2).replace(/0$/, "");
  return `${input.lowerBound ? "≥" : ""}${amount} bucket${rounded === 1 && !input.lowerBound ? "" : "s"}`;
}

function cropLabel(input: FlowerPreparationInput) {
  if (!input.variety) return input.cropLabel;
  return input.variety.toLowerCase().includes(input.cropLabel.toLowerCase()) ? input.variety : `${input.variety} ${input.cropLabel}`;
}

function newOutput(kind: ReadyKind = "conditioned_bucket"): DraftOutput {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, quantity: "", lowerBound: false };
}

export default function FlowerPreparationFocusPage({ task }: { task: FlowerPreparationTask }) {
  const [outputs, setOutputs] = useState<DraftOutput[]>([newOutput()]);
  const [nothingSaleable, setNothingSaleable] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const returnTo = task.returnTo || (task.dueDate ? `/day?date=${encodeURIComponent(task.dueDate)}` : "/");

  const totalHarvestFloor = useMemo(
    () => task.inputs.reduce((sum, input) => sum + input.bucketEquivalentFloor, 0),
    [task.inputs],
  );
  const harvestLowerBound = task.inputs.some((input) => input.lowerBound);

  function updateOutput(id: string, patch: Partial<DraftOutput>) {
    setOutputs((current) => current.map((output) => output.id === id ? { ...output, ...patch } : output));
  }

  function removeOutput(id: string) {
    setOutputs((current) => current.filter((output) => output.id !== id));
  }

  const normalizedOutputs = outputs.flatMap((output) => {
    const quantity = Number(output.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return [];
    return [{ kind: output.kind, quantity, lowerBound: output.kind === "conditioned_bucket" && output.lowerBound }];
  });
  const canSubmit = nothingSaleable || (normalizedOutputs.length === outputs.length && normalizedOutputs.length > 0);

  async function submit() {
    if (!canSubmit) return;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/flower-preparation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          outputs: nothingSaleable ? [] : normalizedOutputs,
          noSaleableOutput: nothingSaleable,
          note: note.trim() || null,
          idempotencyKey: `flower-preparation:${task.id}:${Date.now()}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; readyLots?: unknown[] };
      if (!response.ok || !data.ok) throw new Error(data.error || "Preparation result failed.");
      const readyCount = Array.isArray(data.readyLots) ? data.readyLots.length : 0;
      setMessage(nothingSaleable ? "Preparation recorded. Nothing from this batch entered Ready inventory." : `Preparation recorded. ${readyCount} Ready lot${readyCount === 1 ? "" : "s"} created.`);
      window.setTimeout(() => window.location.assign(returnTo), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preparation result failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href={returnTo} className={styles.brand}><small>Atlas</small><strong>Prepare</strong></Link>
        <Link href={returnTo} className={styles.close} aria-label="Close flower preparation">×</Link>
      </header>

      <div className={styles.body}>
        <article className={styles.ticket}>
          <section className={styles.hero}>
            <div className={styles.kicker}><span>Completed handling</span><span>{prettyDate(task.dueDate)}</span></div>
            <h1>Harvested flowers</h1>
            <p>Harvested {prettyDate(task.harvestDate)}</p>
          </section>

          <section className={styles.facts} aria-label="Preparation source">
            <div className={`${styles.fact} ${styles.factWide}`}>
              <small>Physical input</small>
              <strong>{harvestLowerBound ? "≥" : ""}{Math.round(totalHarvestFloor * 100) / 100} bucket-equivalent across {task.inputs.length} harvest record{task.inputs.length === 1 ? "" : "s"}</strong>
            </div>
            <div className={`${styles.fact} ${styles.factWide}`}>
              <small>Preparation rule</small>
              <strong>Record what is actually saleable after handling. Count stems only when the sale unit itself requires stems.</strong>
            </div>
          </section>

          <section className={styles.prompt}>
            <small>Harvested → Prepare → Ready</small>
            <h2>What is Ready now?</h2>
            <p>Ready means the handling is finished and this output can actually be offered or used. Harvested flowers do not become Ready automatically.</p>
          </section>

          <section className={styles.form}>
            <div>
              {task.inputs.map((input) => (
                <div className={styles.fact} key={input.id}>
                  <small>{prettyDate(input.observedDate)}</small>
                  <strong>{cropLabel(input)} · {amountLabel(input)}</strong>
                </div>
              ))}
            </div>

            <label><span>Did anything saleable result?</span></label>
            <div className={styles.toggle}>
              <button type="button" data-active={!nothingSaleable} onClick={() => setNothingSaleable(false)}>Yes · create Ready inventory</button>
              <button type="button" data-active={nothingSaleable} onClick={() => setNothingSaleable(true)}>No · nothing saleable</button>
            </div>

            {!nothingSaleable ? (
              <div>
                {outputs.map((output, index) => {
                  const choice = READY_CHOICES.find((candidate) => candidate.key === output.kind) ?? READY_CHOICES[0];
                  const bucketKind = output.kind === "conditioned_bucket";
                  return (
                    <div className={styles.form} key={output.id}>
                      <label>
                        <span>Ready output {index + 1}</span>
                        <select value={output.kind} onChange={(event) => {
                          const kind = event.target.value as ReadyKind;
                          updateOutput(output.id, { kind, lowerBound: kind === "conditioned_bucket" ? output.lowerBound : false });
                        }}>
                          {READY_CHOICES.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}
                        </select>
                      </label>
                      <p className={styles.message}>{choice.detail}</p>
                      <label>
                        <span>Quantity · {choice.unit}</span>
                        <input
                          inputMode="decimal"
                          type="number"
                          min={bucketKind ? "0.25" : "1"}
                          step={bucketKind ? "0.25" : "1"}
                          value={output.quantity}
                          onChange={(event) => updateOutput(output.id, { quantity: event.target.value })}
                          placeholder={bucketKind ? "1" : "1"}
                        />
                      </label>
                      {bucketKind ? (
                        <div className={styles.toggle}>
                          <button type="button" data-active={!output.lowerBound} onClick={() => updateOutput(output.id, { lowerBound: false })}>Exact bucket amount</button>
                          <button type="button" data-active={output.lowerBound} onClick={() => updateOutput(output.id, { lowerBound: true })}>At least this much</button>
                        </div>
                      ) : null}
                      {outputs.length > 1 ? <button type="button" className={styles.choice} onClick={() => removeOutput(output.id)}>Remove this output</button> : null}
                    </div>
                  );
                })}
                <button type="button" className={styles.choice} onClick={() => setOutputs((current) => [...current, newOutput("bouquet")])}>+ Add another Ready output</button>
              </div>
            ) : null}

            <label><span>Preparation note (optional)</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Conditioning, cooling, quality, assembly, or discard note." /></label>
            <button type="button" className={styles.submit} disabled={saving || !canSubmit} onClick={() => void submit()}>{saving ? "Recording…" : "Record preparation"}</button>
            {message ? <p className={styles.message}>{message}</p> : null}
          </section>
        </article>
      </div>
    </main>
  );
}
