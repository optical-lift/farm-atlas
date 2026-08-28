"use client";

import { useMemo, useRef, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import type { DirectHarvestContext } from "@/lib/atlas/direct-harvest-context";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import styles from "./direct-harvest-task-detail.module.css";

type Props = {
  task: AtlasTaskCard;
  assignee: AtlasAssigneeConfig;
  initialContext: DirectHarvestContext;
};

type OutputKind = "bundle" | "bouquet" | "posy" | "lobby_arrangement";

type DirectionLine = {
  id: string;
  product: string;
  outputKind: OutputKind;
  requestedQuantity: number;
  stemsPerUnit: number | null;
  note: string;
};

type SubmitResponse = {
  ok?: boolean;
  error?: string;
  directiveId?: string;
  preparationTaskId?: string | null;
};

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function directiveKey(taskId: string) {
  return `flower-preparation-directive:v1:${taskId}:${newId()}`;
}

function newLine(outputKind: OutputKind = "bundle"): DirectionLine {
  return {
    id: newId(),
    product: "",
    outputKind,
    requestedQuantity: 1,
    stemsPerUnit: outputKind === "bundle" ? 10 : null,
    note: "",
  };
}

function normalizeLabel(value: string) {
  return value.trim().toLocaleLowerCase();
}

function prettyDate(value: string | null | undefined) {
  if (!value) return "Today’s flower harvest";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Today’s flower harvest";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function DirectionRow({ line, onChange, onRemove, disabled, sourceLabels }: {
  line: DirectionLine;
  onChange: (next: DirectionLine) => void;
  onRemove: () => void;
  disabled: boolean;
  sourceLabels: string[];
}) {
  const listId = `harvest-products-${line.id}`;
  return (
    <article className={styles.directionRow}>
      <div className={styles.productLine}>
        <label>
          <span>Flower / product</span>
          <input
            list={listId}
            value={line.product}
            disabled={disabled}
            maxLength={160}
            onChange={(event) => onChange({ ...line, product: event.target.value })}
            placeholder="Teddy sunflower"
          />
          <datalist id={listId}>
            {sourceLabels.map((label) => <option value={label} key={label} />)}
          </datalist>
        </label>
        <button className={styles.removeButton} type="button" disabled={disabled} aria-label={`Remove ${line.product || "direction"}`} onClick={onRemove}>×</button>
      </div>

      <div className={styles.directionControls}>
        <label>
          <span>Pack as</span>
          <select value={line.outputKind} disabled={disabled} onChange={(event) => {
            const outputKind = event.target.value as OutputKind;
            onChange({ ...line, outputKind, stemsPerUnit: outputKind === "bundle" ? (line.stemsPerUnit ?? 10) : null });
          }}>
            <option value="bundle">Bunch</option>
            <option value="bouquet">Bouquet</option>
            <option value="posy">Posy</option>
            <option value="lobby_arrangement">Arrangement</option>
          </select>
        </label>

        {line.outputKind === "bundle" ? (
          <label>
            <span>Stems / bunch</span>
            <input
              type="number"
              min={1}
              max={1000}
              inputMode="numeric"
              disabled={disabled}
              value={line.stemsPerUnit ?? 10}
              onChange={(event) => onChange({ ...line, stemsPerUnit: Math.max(1, Math.min(1000, Number(event.target.value) || 1)) })}
            />
          </label>
        ) : <span className={styles.controlSpacer} aria-hidden="true" />}

        <label>
          <span>QTY</span>
          <input
            type="number"
            min={1}
            max={10000}
            inputMode="numeric"
            disabled={disabled}
            value={line.requestedQuantity}
            onChange={(event) => onChange({ ...line, requestedQuantity: Math.max(1, Math.min(10000, Number(event.target.value) || 1)) })}
          />
        </label>
      </div>

      <details className={styles.noteDrawer}>
        <summary>Note (optional)</summary>
        <label>
          <span>Instruction</span>
          <input
            maxLength={1000}
            disabled={disabled}
            placeholder={`Optional note for ${line.product || "this order"}`}
            value={line.note}
            onChange={(event) => onChange({ ...line, note: event.target.value })}
          />
        </label>
      </details>
    </article>
  );
}

export default function DirectHarvestTaskDetail({ task, assignee, initialContext }: Props) {
  const [lines, setLines] = useState<DirectionLine[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const retryRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const sourceLabels = useMemo(
    () => Array.from(new Set(initialContext.sourceRows.map((row) => row.label).filter(Boolean))),
    [initialContext.sourceRows],
  );

  function replaceLine(id: string, next: DirectionLine) {
    setLines((current) => current.map((line) => line.id === id ? next : line));
    setMessage(null);
  }

  function addLine() {
    if (lines.length >= 12 || saving) return;
    setLines((current) => [...current, newLine("bouquet")]);
    setMessage(null);
  }

  const validLines = lines.length > 0 && lines.length <= 12 && lines.every((line) => (
    line.product.trim().length > 0
    && line.product.trim().length <= 160
    && line.requestedQuantity >= 1
    && line.requestedQuantity <= 10000
    && (line.outputKind !== "bundle" || Boolean(line.stemsPerUnit && line.stemsPerUnit >= 1 && line.stemsPerUnit <= 1000))
    && line.note.length <= 1000
  ));

  async function sendToAnna() {
    if (!validLines || saving || !initialContext.ok) return;

    const requestLines = lines.map((line) => {
      const exactSource = initialContext.sourceRows.find((row) => row.cropProfileId && normalizeLabel(row.label) === normalizeLabel(line.product));
      return {
        cropProfileId: exactSource?.cropProfileId ?? null,
        productLabel: line.product.trim(),
        outputKind: line.outputKind,
        requestedQuantity: line.requestedQuantity,
        stemsPerUnit: line.outputKind === "bundle" ? line.stemsPerUnit : null,
        note: line.note.trim() || null,
      };
    });

    const fingerprint = JSON.stringify(requestLines);
    const retry = retryRef.current?.fingerprint === fingerprint
      ? retryRef.current
      : { fingerprint, key: directiveKey(task.task_id) };
    retryRef.current = retry;

    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/flower-preparation-directive", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.task_id,
          lines: requestLines,
          note: null,
          idempotencyKey: retry.key,
        }),
      });
      const body = await response.json() as SubmitResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "Harvest direction failed.");

      retryRef.current = null;
      window.location.assign(assignee.listPath || "/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Harvest direction failed.");
    } finally {
      setSaving(false);
    }
  }

  const trail = [
    { label: "Harvested", detail: initialContext.harvestSummaryDetail, state: "done" },
    { label: "Pre-sale plan", detail: "you are here", state: "now" },
    { label: "Deliver", detail: "next task", state: "locked" },
  ] as const;

  return (
    <main className={styles.shell} data-atlas-direct-harvest="true">
      <AtlasTaskCardFrame
        family="Harvest"
        familyDetail="pre-sale"
        title="Direct Harvest"
        subtitle={`${prettyDate(initialContext.harvestDate)} · Elm Farm`}
        timing="Harvest complete · nothing released to Anna yet"
        completion={
          <div className={styles.completion}>
            {message ? <p className={styles.error} role="status">{message}</p> : null}
            <button type="button" disabled={saving || !validLines || !initialContext.ok} onClick={() => void sendToAnna()}>
              {saving ? "Sending…" : "Send to Anna"}
            </button>
            <small>Nothing is released until you send this.</small>
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

        <section className={styles.harvestSummary}>
          <header>
            <div><span>Harvest is in</span><strong>Use what Anna actually logged</strong></div>
            <small>read only</small>
          </header>
          {initialContext.error ? <p className={styles.contextWarning}>{initialContext.error}</p> : null}
          <div className={styles.sourceRows}>
            {initialContext.sourceRows.length ? initialContext.sourceRows.map((item) => (
              <div className={styles.sourceRow} key={item.key}>
                <strong>{item.label}</strong><small>{item.detail}</small>
              </div>
            )) : <p className={styles.empty}>No flower custody rows were available for this completed Harvest.</p>}
          </div>
        </section>

        <section className={styles.directionSection}>
          <header>
            <div><span>Orders</span><strong>Set the pack-out target.</strong></div>
          </header>

          <div className={styles.directionList}>
            {lines.map((line) => (
              <DirectionRow
                key={line.id}
                line={line}
                sourceLabels={sourceLabels}
                disabled={saving}
                onChange={(next) => replaceLine(line.id, next)}
                onRemove={() => setLines((current) => current.filter((candidate) => candidate.id !== line.id))}
              />
            ))}
          </div>

          <button className={styles.addButton} type="button" disabled={saving || lines.length >= 12} onClick={addLine}>Add another</button>
        </section>
      </AtlasTaskCardFrame>
    </main>
  );
}
