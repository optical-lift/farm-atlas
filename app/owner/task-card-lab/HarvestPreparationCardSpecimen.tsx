"use client";

import { useMemo, useState } from "react";

import DominionCardFrame from "./DominionCardFrame";
import styles from "./harvest-preparation-card-specimen.module.css";

type PrepLine = {
  id: string;
  product: string;
  instruction: string;
  requestedQuantity: number;
  deterministicStemsPerUnit: number | null;
};

type HarvestProduct = {
  product: string;
  harvestedStems: number | null;
  orderLineId?: string;
};

const prepLines: PrepLine[] = [
  { id: "pink-zinnia", product: "Pink zinnias", instruction: "10-stem bunches", requestedQuantity: 3, deterministicStemsPerUnit: 10 },
  { id: "celosia", product: "Celosia", instruction: "10-stem bunches", requestedQuantity: 3, deterministicStemsPerUnit: 10 },
  { id: "lemon-basil", product: "Lemon basil", instruction: "10-stem bunches", requestedQuantity: 2, deterministicStemsPerUnit: 10 },
  { id: "goldenrod", product: "Goldenrod", instruction: "10-stem bunches", requestedQuantity: 3, deterministicStemsPerUnit: 10 },
  { id: "teddy-sunflower", product: "Teddy sunflower", instruction: "10-stem bunches", requestedQuantity: 3, deterministicStemsPerUnit: 10 },
];

const harvestedProducts: HarvestProduct[] = [
  { product: "Pink zinnias", harvestedStems: null, orderLineId: "pink-zinnia" },
  { product: "Celosia", harvestedStems: 57, orderLineId: "celosia" },
  { product: "Lemon basil", harvestedStems: null, orderLineId: "lemon-basil" },
  { product: "Goldenrod", harvestedStems: null, orderLineId: "goldenrod" },
  { product: "Teddy sunflower", harvestedStems: 36, orderLineId: "teddy-sunflower" },
  { product: "ProCut Plum sunflower", harvestedStems: 6 },
  { product: "Rudbeckia", harvestedStems: 3 },
  { product: "Dahlia", harvestedStems: 4 },
  { product: "Yarrow", harvestedStems: null },
];

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
  const [actuals, setActuals] = useState<Record<string, number>>(initialActuals);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [remainderAdjustments, setRemainderAdjustments] = useState<Record<string, number>>({});
  const [manualRemainders, setManualRemainders] = useState<Record<string, number | null>>({});

  function changeActual(id: string, delta: number) {
    setActuals((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) + delta) }));
  }

  function expectedRemainder(item: HarvestProduct) {
    if (item.harvestedStems == null) return null;
    if (!item.orderLineId) return item.harvestedStems;
    const line = prepLines.find((candidate) => candidate.id === item.orderLineId);
    if (!line || line.deterministicStemsPerUnit == null) return null;
    const usedStems = (actuals[line.id] ?? 0) * line.deterministicStemsPerUnit;
    return Math.max(0, item.harvestedStems - usedStems);
  }

  function changeCalculatedRemainder(product: string, delta: number, expected: number) {
    setRemainderAdjustments((current) => {
      const nextValue = Math.max(0, expected + (current[product] ?? 0) + delta);
      return { ...current, [product]: nextValue - expected };
    });
  }

  function changeManualRemainder(product: string, delta: number) {
    setManualRemainders((current) => {
      const currentValue = current[product];
      const nextValue = Math.max(0, (currentValue ?? 0) + delta);
      return { ...current, [product]: nextValue };
    });
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
            <div><span>Remaining stems</span><strong>Confirm or correct what Atlas expects</strong></div>
            <small>Post-packout</small>
          </header>

          <div className={styles.remainingList}>
            {harvestedProducts.map((item) => {
              const expected = expectedRemainder(item);
              const adjustment = remainderAdjustments[item.product] ?? 0;
              const displayed = expected == null ? manualRemainders[item.product] : Math.max(0, expected + adjustment);
              const corrected = expected != null && adjustment !== 0;
              return (
                <div className={styles.remainingRow} key={item.product}>
                  <div className={styles.remainingIdentity}>
                    <strong>{item.product}</strong>
                    {expected == null ? (
                      <small>Count needed</small>
                    ) : item.orderLineId ? (
                      <small>{item.harvestedStems} harvested · Atlas subtracts packed stems</small>
                    ) : (
                      <small>{item.harvestedStems} harvested · no direct-stem order</small>
                    )}
                  </div>
                  <div className={styles.remainingControl}>
                    <span>{expected == null ? "Count" : corrected ? "Corrected" : "Atlas expects"}</span>
                    <div className={styles.stepper} aria-label={`Remaining stems for ${item.product}`}>
                      <button
                        type="button"
                        aria-label={`Remove one remaining ${item.product} stem`}
                        disabled={(displayed ?? 0) === 0}
                        onClick={() => expected == null ? changeManualRemainder(item.product, -1) : changeCalculatedRemainder(item.product, -1, expected)}
                      >−</button>
                      <strong>{displayed == null ? "—" : displayed}</strong>
                      <button
                        type="button"
                        aria-label={`Add one remaining ${item.product} stem`}
                        onClick={() => expected == null ? changeManualRemainder(item.product, 1) : changeCalculatedRemainder(item.product, 1, expected)}
                      >+</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </DominionCardFrame>
    </div>
  );
}
