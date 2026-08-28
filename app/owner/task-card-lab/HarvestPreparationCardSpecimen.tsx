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

type OpenStockEntry = {
  id: string;
  product: string;
  pack: string;
  quantity: number;
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

const packOptions = ["10-stem bunch", "5-stem bunch", "Bouquet", "Posy"] as const;

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
  const [stockProduct, setStockProduct] = useState<(typeof harvestedProducts)[number]>(harvestedProducts[0]);
  const [stockPack, setStockPack] = useState<(typeof packOptions)[number]>(packOptions[0]);
  const [stockQuantity, setStockQuantity] = useState(0);
  const [stockEntries, setStockEntries] = useState<OpenStockEntry[]>([]);

  function changeActual(id: string, delta: number) {
    setActuals((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) + delta) }));
  }

  function logOpenStock() {
    if (stockQuantity <= 0) return;
    setStockEntries((current) => [
      ...current,
      { id: `${stockProduct}-${stockPack}-${current.length + 1}`, product: stockProduct, pack: stockPack, quantity: stockQuantity },
    ]);
    setStockQuantity(0);
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

        <section className={styles.openStockSection}>
          <header>
            <div><span>Open Stock</span><strong>Finished product not assigned to an order</strong></div>
            <small>Sellable</small>
          </header>

          <div className={styles.stockComposer}>
            <div className={styles.stockSentence}>
              <strong>{stockProduct}</strong><span>·</span><strong>{stockPack}</strong><span>·</span><strong>{stockQuantity}</strong>
            </div>

            <div className={styles.sentenceStep}>
              <span>Flower</span>
              <div className={styles.pillGrid}>
                {harvestedProducts.map((product) => (
                  <button type="button" className={stockProduct === product ? styles.pillSelected : ""} key={product} onClick={() => setStockProduct(product)}>{product}</button>
                ))}
              </div>
            </div>

            <div className={styles.sentenceStep}>
              <span>Pack</span>
              <div className={styles.pillGrid}>
                {packOptions.map((pack) => (
                  <button type="button" className={stockPack === pack ? styles.pillSelected : ""} key={pack} onClick={() => setStockPack(pack)}>{pack}</button>
                ))}
              </div>
            </div>

            <div className={styles.stockCountRow}>
              <span>Made</span>
              <div className={styles.stepper}>
                <button type="button" aria-label="Remove one open-stock item" disabled={stockQuantity === 0} onClick={() => setStockQuantity((current) => Math.max(0, current - 1))}>−</button>
                <strong>{stockQuantity}</strong>
                <button type="button" aria-label="Add one open-stock item" onClick={() => setStockQuantity((current) => current + 1)}>+</button>
              </div>
              <button className={styles.logStockButton} type="button" disabled={stockQuantity === 0} onClick={logOpenStock}>Log open stock</button>
            </div>

            {stockEntries.length ? (
              <div className={styles.stockEntries}>
                {stockEntries.map((entry) => (
                  <div className={styles.stockEntry} key={entry.id}>
                    <strong>{entry.quantity} × {entry.product}</strong>
                    <small>{entry.pack}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </DominionCardFrame>
    </div>
  );
}
