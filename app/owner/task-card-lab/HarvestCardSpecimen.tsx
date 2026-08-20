"use client";

import { useState } from "react";

import styles from "./harvest-card-specimen.module.css";

type HarvestBed = {
  id: string;
  place: string;
  crop: string;
  timing: string;
  timingTone: "now" | "repeat" | "soon";
};

type BedResult = "harvested" | "nothing_ready" | "left_for_later" | null;

const harvestBeds: HarvestBed[] = [
  {
    id: "field-row-6",
    place: "Field Row 6",
    crop: "ProCut White Lite sunflower",
    timing: "Day 54 · 50–60 day window",
    timingTone: "now",
  },
  {
    id: "berry-walk-3",
    place: "Berry Walk Row 3",
    crop: "Zinnia mix",
    timing: "Repeat cut · last cut Aug 13",
    timingTone: "repeat",
  },
  {
    id: "curve-garden-2",
    place: "Curve Garden Bed 2",
    crop: "Celosia",
    timing: "Harvesting now",
    timingTone: "now",
  },
  {
    id: "barn-bed-4",
    place: "Barn Bed 4",
    crop: "White snapdragon",
    timing: "Window opens Aug 22",
    timingTone: "soon",
  },
];

function HarvestTrail() {
  return (
    <div className={styles.trail} aria-label="Thursday harvest recurrence trail">
      <span className={styles.trailDone}>
        <b>Harvested</b>
        <small>Aug 13</small>
      </span>
      <span className={styles.trailNow}>
        <b>Harvest</b>
        <small>Aug 20</small>
      </span>
      <span className={styles.trailNext}>
        <b>Next harvest</b>
        <small>Aug 27</small>
      </span>
    </div>
  );
}

function HarvestBedSection({ bed }: { bed: HarvestBed }) {
  const [result, setResult] = useState<BedResult>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [quantity, setQuantity] = useState<string | null>(null);

  return (
    <section className={styles.bedSection}>
      <header className={styles.bedHeader}>
        <div>
          <h3>{bed.place}</h3>
          <p>{bed.crop}</p>
        </div>
        <span className={`${styles.windowPill} ${styles[bed.timingTone]}`}>{bed.timing}</span>
      </header>

      <div className={styles.resultRow} aria-label={`Record harvest result for ${bed.place}`}>
        <button
          type="button"
          className={result === "harvested" ? styles.selected : undefined}
          onClick={() => {
            setResult("harvested");
            setLogOpen(true);
          }}
        >
          Harvested
        </button>
        <button
          type="button"
          className={result === "nothing_ready" ? styles.selected : undefined}
          onClick={() => {
            setResult("nothing_ready");
            setLogOpen(false);
          }}
        >
          Nothing ready
        </button>
        <button
          type="button"
          className={result === "left_for_later" ? styles.selected : undefined}
          onClick={() => {
            setResult("left_for_later");
            setLogOpen(false);
          }}
        >
          Left for later
        </button>
        <button type="button" className={styles.logButton} onClick={() => setLogOpen((open) => !open)}>
          Log it
        </button>
      </div>

      {logOpen ? (
        <div className={styles.logPanel}>
          <span>Harvest</span>
          <div className={styles.quantityPills}>
            {["12 stems", "24 stems", "1 bucket", "Other"].map((option) => (
              <button
                key={option}
                type="button"
                className={quantity === option ? styles.selectedQuantity : undefined}
                onClick={() => setQuantity(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <label>
            <span>Note</span>
            <input type="text" placeholder="Only if something needs saying…" />
          </label>
        </div>
      ) : null}
    </section>
  );
}

export default function HarvestCardSpecimen() {
  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Harvest</span>
        </div>
        <h2>Thursday Harvest</h2>
        <p>4 beds in harvest window</p>
      </header>

      <HarvestTrail />

      <section className={styles.windowSummary}>
        <span>In window this week</span>
        <strong>4</strong>
      </section>

      <div className={styles.bedList}>
        {harvestBeds.map((bed) => <HarvestBedSection key={bed.id} bed={bed} />)}
      </div>

      <footer className={styles.finish}>
        <span>Finish harvest</span>
        <button type="button">Harvest round checked</button>
        <small>Fixture-only collection card · each bed result would write back to that planting, not to a generic harvest note.</small>
      </footer>
    </article>
  );
}
