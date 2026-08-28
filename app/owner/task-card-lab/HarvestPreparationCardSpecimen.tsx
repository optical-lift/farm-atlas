"use client";

import { useMemo, useState } from "react";

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

const harvestedProducts = [
  "Pink zinnias",
  "Celosia",
  "Lemon basil",
  "Goldenrod",
  "Teddy sunflower",
  "ProCut Plum sunflower",
  "Rudbeckia",
  "Dahlia",
  "Yarrow",
] as const;

const trailSteps = [
  { label: "Harvested", detail: "248+ stems", state: "done" },
  { label: "Condition + bunch", detail: "you are here", state: "now" },
  { label: "Deliver", detail: "Katie Langenberg", state: "locked" },
] as const;

function NoteDrawer({ value, onChange, product }: { value: string; onChange: (value: string) => void; product: string }) {
  return (
    <details className={styles.noteDrawer}>
      <summary>Note (optional)</summary>
      <label>
        <span>Note (optional)</span>
        <input value={value} onChange={(event) => onChange(event.target.value)} aria-label={`Note for ${product}`} />
      </label>
    </details>
  );
}

export default function HarvestPreparationCardSpecimen() {
  const initialActuals = useMemo(
    () => Object.fromEntries(prepLines.map((line) => [line.id, line.requestedQuantity])) as Record<string, number>,
    [],
  );
  const initialRemainders = useMemo(
    () => Object.fromEntries(harvestedProducts.map((product) => [product, 0])) as Record<string, number>,
    [],
  );
  const [actuals, setActuals] = useState<Record<string, number>>(initialActuals);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [remainders, setRemainders] = useState<Record<string, number>>(initialRemainders);

  function changeActual(id: string, delta: number) {
    setActuals((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) + delta) }));
  }

  function changeRemainder(product: string, delta: number) {
    setRemainders((current) => ({ ...current, [product]: Math.max(0, (current[product] ?? 0) + delta) }));
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

                <NoteDrawer
                  product={line.product}
                  value={notes[line.id] ?? ""}
                  onChange={(value) => setNotes((current) => ({ ...current, [line.id]: value }))}
                />
              </article>
            ))}
          </div>
        </section>

        <section className={styles.remainingSection}>
          <header>
            <div><span>Remaining stems</span><strong>Count by variety after pack-out</strong></div>
            <small>Unallocated</small>
          </header>

          <div className={styles.remainingList}>
            {harvestedProducts.map((product) => (
              <div className={styles.remainingRow} key={product}>
                <div>
                  <strong>{product}</strong>
                  <small>stems remaining</small>
                </div>
                <div className={styles.stepper} aria-label={`Remaining stems for ${product}`}>
                  <button type="button" aria-label={`Remove one remaining ${product} stem`} disabled={(remainders[product] ?? 0) === 0} onClick={() => changeRemainder(product, -1)}>−</button>
                  <strong>{remainders[product] ?? 0}</strong>
                  <button type="button" aria-label={`Add one remaining ${product} stem`} onClick={() => changeRemainder(product, 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </DominionCardFrame>
    </div>
  );
}
