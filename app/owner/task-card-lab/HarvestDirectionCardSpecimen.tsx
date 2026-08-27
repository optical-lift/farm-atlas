"use client";

import { useState } from "react";

import DominionCardFrame from "./DominionCardFrame";
import styles from "./harvest-direction-card-specimen.module.css";

type OutputKind = "bundle" | "bouquet" | "posy" | "lobby_arrangement";

type DirectionLine = {
  id: string;
  product: string;
  outputKind: OutputKind;
  requestedQuantity: number;
  stemsPerUnit: number | null;
  note: string;
};

const sourceSummary = [
  { label: "Pink zinnias", detail: "harvested stems available" },
  { label: "Celosia", detail: "harvested stems available" },
  { label: "Lemon basil", detail: "harvested stems available" },
  { label: "Goldenrod", detail: "harvested stems available" },
  { label: "Teddy sunflower", detail: "harvested stems available" },
] as const;

const startingLines: DirectionLine[] = [
  { id: "pink-zinnia", product: "Pink zinnias", outputKind: "bundle", requestedQuantity: 3, stemsPerUnit: 10, note: "" },
  { id: "celosia", product: "Celosia", outputKind: "bundle", requestedQuantity: 3, stemsPerUnit: 10, note: "" },
  { id: "lemon-basil", product: "Lemon basil", outputKind: "bundle", requestedQuantity: 2, stemsPerUnit: 10, note: "" },
  { id: "goldenrod", product: "Goldenrod", outputKind: "bundle", requestedQuantity: 3, stemsPerUnit: 10, note: "" },
  { id: "teddy-sunflower", product: "Teddy sunflower", outputKind: "bundle", requestedQuantity: 3, stemsPerUnit: 10, note: "" },
];

const trailSteps = [
  { label: "Harvested", detail: "Anna logged it", state: "done" },
  { label: "Direct", detail: "Owner decides", state: "now" },
  { label: "Prepare", detail: "hidden from Anna", state: "locked" },
  { label: "Ready", detail: "actuals confirmed", state: "locked" },
] as const;

function outputLabel(kind: OutputKind) {
  if (kind === "lobby_arrangement") return "Arrangement";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function DirectionRow({ line, onChange, onRemove }: { line: DirectionLine; onChange: (next: DirectionLine) => void; onRemove: () => void }) {
  return (
    <article className={styles.directionRow}>
      <div className={styles.productLine}>
        <label>
          <span>Flower / product</span>
          <input value={line.product} onChange={(event) => onChange({ ...line, product: event.target.value })} />
        </label>
        <button className={styles.removeButton} type="button" aria-label={`Remove ${line.product || "direction"}`} onClick={onRemove}>×</button>
      </div>

      <div className={styles.directionControls}>
        <label>
          <span>Make</span>
          <select value={line.outputKind} onChange={(event) => {
            const outputKind = event.target.value as OutputKind;
            onChange({ ...line, outputKind, stemsPerUnit: outputKind === "bundle" ? (line.stemsPerUnit ?? 10) : null });
          }}>
            <option value="bundle">Bundle</option>
            <option value="bouquet">Bouquet</option>
            <option value="posy">Posy</option>
            <option value="lobby_arrangement">Arrangement</option>
          </select>
        </label>

        {line.outputKind === "bundle" ? (
          <label>
            <span>Stems each</span>
            <input type="number" min={1} inputMode="numeric" value={line.stemsPerUnit ?? 10} onChange={(event) => onChange({ ...line, stemsPerUnit: Math.max(1, Number(event.target.value) || 1) })} />
          </label>
        ) : null}

        <label>
          <span>Want</span>
          <input type="number" min={1} inputMode="numeric" value={line.requestedQuantity} onChange={(event) => onChange({ ...line, requestedQuantity: Math.max(1, Number(event.target.value) || 1) })} />
        </label>
      </div>

      <details className={styles.noteDrawer}>
        <summary>+ note</summary>
        <label>
          <span>Instruction for this line</span>
          <input placeholder={`Optional note for ${line.product || outputLabel(line.outputKind)}`} value={line.note} onChange={(event) => onChange({ ...line, note: event.target.value })} />
        </label>
      </details>
    </article>
  );
}

export default function HarvestDirectionCardSpecimen() {
  const [lines, setLines] = useState<DirectionLine[]>(startingLines);

  function replaceLine(id: string, next: DirectionLine) {
    setLines((current) => current.map((line) => line.id === id ? next : line));
  }

  function addLine() {
    setLines((current) => [
      ...current,
      { id: `new-${current.length + 1}`, product: "", outputKind: "bouquet", requestedQuantity: 1, stemsPerUnit: null, note: "" },
    ]);
  }

  return (
    <div className={styles.specimen}>
      <div className={styles.variantLabel}><span>Post-harvest owner decision · fixture only</span></div>
      <DominionCardFrame
        family="Harvest"
        familyDetail="owner direction"
        title="Direct Harvest"
        subtitle="Today’s flower harvest · Elm Farm"
        timing="Harvest complete · nothing released to Anna yet"
        completion={
          <div className={styles.completion}>
            <button type="button">Send to Anna</button>
            <small>Nothing is released until you send this.</small>
          </div>
        }
      >
        <div className={styles.trail} aria-label="Post-harvest handoff trail">
          {trailSteps.map((step) => (
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
          <div className={styles.sourceRows}>
            {sourceSummary.map((item) => (
              <div className={styles.sourceRow} key={item.label}>
                <strong>{item.label}</strong><small>{item.detail}</small>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.directionSection}>
          <header>
            <div><span>What should Anna make?</span><strong>Set the target. Anna will report the actual.</strong></div>
          </header>

          <div className={styles.directionList}>
            {lines.map((line) => (
              <DirectionRow
                key={line.id}
                line={line}
                onChange={(next) => replaceLine(line.id, next)}
                onRemove={() => setLines((current) => current.filter((candidate) => candidate.id !== line.id))}
              />
            ))}
          </div>

          <button className={styles.addButton} type="button" onClick={addLine}>+ Add another</button>
        </section>
      </DominionCardFrame>
    </div>
  );
}
