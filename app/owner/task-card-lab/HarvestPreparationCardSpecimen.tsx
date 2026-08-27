"use client";

import { useState } from "react";

import DominionCardFrame from "./DominionCardFrame";
import styles from "./harvest-preparation-card-specimen.module.css";

type PrepLine = {
  id: string;
  product: string;
  instruction: string;
  requestedQuantity: number;
};

const prepLines: PrepLine[] = [
  { id: "pink-zinnia", product: "Pink zinnias", instruction: "10-stem bundles", requestedQuantity: 3 },
  { id: "celosia", product: "Celosia", instruction: "10-stem bundles", requestedQuantity: 3 },
  { id: "lemon-basil", product: "Lemon basil", instruction: "10-stem bundles", requestedQuantity: 2 },
  { id: "goldenrod", product: "Goldenrod", instruction: "10-stem bundles", requestedQuantity: 3 },
  { id: "teddy-sunflower", product: "Teddy sunflower", instruction: "10-stem bundles", requestedQuantity: 3 },
];

const trailSteps = [
  { label: "Harvested", detail: "you logged it", state: "done" },
  { label: "Directed", detail: "Lex sent plan", state: "done" },
  { label: "Prepare", detail: "you are here", state: "now" },
  { label: "Ready", detail: "after actuals", state: "locked" },
] as const;

export default function HarvestPreparationCardSpecimen() {
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  return (
    <div className={styles.specimen}>
      <div className={styles.variantLabel}><span>What Anna receives after Owner sends · fixture only</span></div>
      <DominionCardFrame
        family="Harvest"
        familyDetail="prepare harvested flowers"
        title="Prepare Harvest"
        subtitle="Today’s flower harvest · Elm Farm"
        timing="Owner directions received · make what you can"
        completion={
          <div className={styles.completion}>
            <button type="button">Flowers are ready</button>
            <small>Finish after every line has a Made amount. Lex receives your actual amounts, not the targets.</small>
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

        <section className={styles.instructions}>
          <header>
            <div><span>Make these</span><strong>Record how many you actually finish.</strong></div>
            <small>Owner direction</small>
          </header>

          <div className={styles.prepList}>
            {prepLines.map((line) => (
              <article className={styles.prepRow} key={line.id}>
                <div className={styles.identity}>
                  <strong>{line.product}</strong>
                  <small>{line.instruction}</small>
                </div>

                <div className={styles.target}>
                  <span>Want</span>
                  <strong>{line.requestedQuantity}</strong>
                </div>

                <label className={styles.actual}>
                  <span>Made</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="—"
                    value={actuals[line.id] ?? ""}
                    onChange={(event) => setActuals((current) => ({ ...current, [line.id]: event.target.value }))}
                    aria-label={`Actual ${line.instruction} made for ${line.product}`}
                  />
                </label>

                <details className={styles.noteDrawer}>
                  <summary>+ note</summary>
                  <label>
                    <span>Optional note</span>
                    <input
                      placeholder="Anything Lex should know?"
                      value={notes[line.id] ?? ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [line.id]: event.target.value }))}
                    />
                  </label>
                </details>
              </article>
            ))}
          </div>

          <div className={styles.truthNote}>
            <strong>Made can be lower, equal, or higher than Want.</strong>
            <small>0 means you made none. A blank line still needs an answer.</small>
          </div>
        </section>
      </DominionCardFrame>
    </div>
  );
}
