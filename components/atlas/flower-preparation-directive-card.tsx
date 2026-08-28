"use client";

import { useMemo, useState } from "react";

import type { FlowerPreparationTask as LegacyFlowerPreparationTask } from "@/app/task-focus/[taskId]/FlowerPreparationFocusPage";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import styles from "./flower-preparation-directive-card.module.css";

export type FlowerPreparationDirectiveLine = {
  id: string;
  lineNumber: number;
  cropProfileId: string | null;
  productLabel: string;
  outputKind: "bundle" | "posy" | "bouquet" | "lobby_arrangement";
  requestedQuantity: number;
  stemsPerUnit: number | null;
  note: string | null;
};

export type FlowerPreparationDirective = {
  id: string;
  note: string | null;
  lines: FlowerPreparationDirectiveLine[];
};

export type DirectiveFlowerPreparationTask = LegacyFlowerPreparationTask & {
  directive: FlowerPreparationDirective;
};

type TransitionResponse = {
  ok?: boolean;
  error?: string | { message?: string };
};

function errorMessage(body: TransitionResponse) {
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") return body.error.message;
  return "Atlas could not record the final tally.";
}

function instructionLabel(line: FlowerPreparationDirectiveLine) {
  if (line.outputKind === "bundle") return `${line.stemsPerUnit ?? "—"}-stem bunches`;
  if (line.outputKind === "posy") return "Posies";
  if (line.outputKind === "bouquet") return "Bouquets";
  return "Arrangements";
}

function harvestDetail(task: LegacyFlowerPreparationTask) {
  const total = task.inputs.reduce((sum, input) => sum + input.bucketEquivalentFloor, 0);
  const rounded = Math.round(total * 100) / 100;
  if (!rounded) return `${task.inputs.length} harvest record${task.inputs.length === 1 ? "" : "s"}`;
  return `${rounded} bucket${rounded === 1 ? "" : "s"}`;
}

function NoteDrawer({ value, onChange, product, disabled }: {
  value: string;
  onChange: (value: string) => void;
  product: string;
  disabled: boolean;
}) {
  return (
    <details className={styles.noteDrawer}>
      <summary>Note (optional)</summary>
      <label>
        <span>Note (optional)</span>
        <input
          maxLength={1000}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Note for ${product}`}
        />
      </label>
    </details>
  );
}

export default function FlowerPreparationDirectiveCard({ task }: { task: DirectiveFlowerPreparationTask }) {
  const directive = task.directive;
  const initialActuals = useMemo(
    () => Object.fromEntries(directive.lines.map((line) => [line.id, line.requestedQuantity])) as Record<string, number>,
    [directive.lines],
  );
  const [actuals, setActuals] = useState<Record<string, number>>(initialActuals);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const returnTo = task.returnTo || (task.dueDate ? `/day?date=${encodeURIComponent(task.dueDate)}` : "/");

  function changeActual(id: string, delta: number) {
    if (saving) return;
    setActuals((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) + delta) }));
    setMessage(null);
  }

  async function finish() {
    if (saving) return;
    const actualLines = directive.lines.map((line) => ({
      directiveLineId: line.id,
      productLabel: line.productLabel,
      outputKind: line.outputKind,
      stemsPerUnit: line.stemsPerUnit,
      requestedQuantity: line.requestedQuantity,
      actualQuantity: actuals[line.id] ?? 0,
      note: notes[line.id]?.trim() || null,
    }));

    try {
      setSaving(true);
      setMessage(null);
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
          idempotencyKey: `flower-preparation-final-tally:v1:${task.id}:${directive.id}`,
          note: null,
          payload: {
            flowerPreparationDirectiveResultVersion: 1,
            flowerPreparationDirectiveId: directive.id,
            truthBoundary: "worker_finished_preparation_tally",
            readyInventoryCreated: false,
            actualLines,
          },
        }),
      });
      const body = await response.json() as TransitionResponse;
      if (!response.ok || !body.ok) throw new Error(errorMessage(body));
      window.location.assign(returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not record the final tally.");
    } finally {
      setSaving(false);
    }
  }

  const trail = [
    { label: "Harvested", detail: harvestDetail(task), state: "done" },
    { label: "Condition + bunch", detail: "you are here", state: "now" },
    { label: "Deliver", detail: "next task", state: "locked" },
  ] as const;

  return (
    <main className={styles.shell} data-atlas-flower-preparation-directive="true">
      <AtlasTaskCardFrame
        family="Harvest"
        familyDetail="sellable"
        title="Condition + Bunch"
        subtitle="Today’s pre-sale flowers · Elm Farm"
        timing="Condition + bundle for pre-sales"
        completion={
          <div className={styles.completion}>
            {message ? <p className={styles.error} role="status">{message}</p> : null}
            <button type="button" disabled={saving} onClick={() => void finish()}>
              {saving ? "Recording…" : "Flowers are ready"}
            </button>
          </div>
        }
      >
        <div className={styles.trail} aria-label="Harvest to delivery trail">
          {trail.map((step) => (
            <span className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLocked} key={step.label}>
              <b>{step.label}</b><small>{step.detail}</small>
            </span>
          ))}
        </div>

        <section className={styles.instructions}>
          <header>
            <div><span>Orders</span><strong>Record final tally</strong></div>
            <small>Sellable</small>
          </header>

          <div className={styles.prepList}>
            {directive.lines.map((line) => (
              <article className={styles.prepRow} key={line.id}>
                <div className={styles.identity}>
                  <strong>{line.productLabel}</strong>
                  <small>{instructionLabel(line)}</small>
                  {line.note ? <em className={styles.directiveNote}>{line.note}</em> : null}
                </div>

                <div className={styles.target}>
                  <span>QTY</span>
                  <strong>{line.requestedQuantity}</strong>
                </div>

                <div className={styles.actual} aria-label={`Made ${instructionLabel(line)} for ${line.productLabel}`}>
                  <span>Made</span>
                  <div className={styles.stepper}>
                    <button
                      type="button"
                      aria-label={`Remove one ${instructionLabel(line)} from ${line.productLabel}`}
                      disabled={saving || (actuals[line.id] ?? 0) === 0}
                      onClick={() => changeActual(line.id, -1)}
                    >−</button>
                    <strong>{actuals[line.id] ?? 0}</strong>
                    <button
                      type="button"
                      aria-label={`Add one ${instructionLabel(line)} to ${line.productLabel}`}
                      disabled={saving}
                      onClick={() => changeActual(line.id, 1)}
                    >+</button>
                  </div>
                </div>

                <NoteDrawer
                  product={line.productLabel}
                  disabled={saving}
                  value={notes[line.id] ?? ""}
                  onChange={(value) => {
                    setNotes((current) => ({ ...current, [line.id]: value }));
                    setMessage(null);
                  }}
                />
              </article>
            ))}
          </div>
        </section>
      </AtlasTaskCardFrame>
    </main>
  );
}
