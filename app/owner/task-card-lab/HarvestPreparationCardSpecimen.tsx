"use client";

import { useMemo, useState } from "react";

import InlineIssueDrawer from "@/components/atlas/inline-issue-drawer";

import DominionCardFrame from "./DominionCardFrame";
import styles from "./harvest-preparation-card-specimen.module.css";

type PrepLine = {
  id: string;
  product: string;
  instruction: string;
  requestedQuantity: number;
};

const prepLines: PrepLine[] = [
  { id: "pink-zinnia", product: "Pink zinnias", instruction: "10-stem bunches", requestedQuantity: 3 },
  { id: "celosia", product: "Celosia", instruction: "10-stem bunches", requestedQuantity: 3 },
  { id: "lemon-basil", product: "Lemon basil", instruction: "10-stem bunches", requestedQuantity: 2 },
  { id: "goldenrod", product: "Goldenrod", instruction: "10-stem bunches", requestedQuantity: 3 },
  { id: "teddy-sunflower", product: "Teddy sunflower", instruction: "10-stem bunches", requestedQuantity: 3 },
];

const trailSteps = [
  { label: "Harvested", detail: "248+ stems", state: "done" },
  { label: "Condition + bunch", detail: "you are here", state: "now" },
  { label: "Deliver", detail: "Katie Langenberg", state: "locked" },
] as const;

export default function HarvestPreparationCardSpecimen() {
  const initialActuals = useMemo(
    () => Object.fromEntries(prepLines.map((line) => [line.id, line.requestedQuantity])) as Record<string, number>,
    [],
  );
  const [actuals, setActuals] = useState<Record<string, number>>(initialActuals);
  const [notes, setNotes] = useState<Record<string, string>>({});

  function changeActual(id: string, delta: number) {
    setActuals((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) + delta) }));
  }

  return (
    <div className={styles.specimen}>
      <div className={styles.variantLabel}><span>What Anna receives after Owner sends · fixture only</span></div>
      <DominionCardFrame
        family="Harvest"
        familyDetail="sellable"
        title="Condition + Bunch"
        subtitle="Today’s pre-sale flowers · Elm Farm"
        timing="Condition + bundle for pre-sales"
        completion={
          <div className={styles.completion}>
            <button type="button">Flowers are ready</button>
          </div>
        }
      >
        <div className={styles.trail} aria-label="Harvest to delivery trail">
          {trailSteps.map((step) => (
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
            {prepLines.map((line) => (
              <article className={styles.prepRow} key={line.id}>
                <div className={styles.identity}>
                  <strong>{line.product}</strong>
                  <small>{line.instruction}</small>
                </div>

                <div className={styles.target}>
                  <span>QTY</span>
                  <strong>{line.requestedQuantity}</strong>
                </div>

                <div className={styles.actual} aria-label={`Made ${line.instruction} for ${line.product}`}>
                  <span>Made</span>
                  <div className={styles.stepper}>
                    <button type="button" aria-label={`Remove one ${line.instruction} from ${line.product}`} disabled={(actuals[line.id] ?? 0) === 0} onClick={() => changeActual(line.id, -1)}>−</button>
                    <strong>{actuals[line.id] ?? 0}</strong>
                    <button type="button" aria-label={`Add one ${line.instruction} to ${line.product}`} onClick={() => changeActual(line.id, 1)}>+</button>
                  </div>
                </div>

                <InlineIssueDrawer triggerLabel={`Add note for ${line.product}`}>
                  <label className={styles.noteField}>
                    <span>Note (optional)</span>
                    <input
                      value={notes[line.id] ?? ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [line.id]: event.target.value }))}
                    />
                  </label>
                </InlineIssueDrawer>
              </article>
            ))}
          </div>

          <div className={styles.truthNote}>
            <small>0 means you made none. A blank line still needs an answer.</small>
          </div>
        </section>
      </DominionCardFrame>
    </div>
  );
}
