"use client";

import { useState } from "react";

import styles from "./harvest-card-specimen.module.css";

type HarvestOutcome = "harvested" | "nothing_ready" | "left_for_later" | "deadheaded";

const trail = [
  { label: "Sown", detail: "Jun 10", state: "done" },
  { label: "Harvest watch", detail: "window open", state: "done" },
  { label: "Harvest", detail: "today", state: "now" },
  { label: "Harvest again", detail: "if producing", state: "later" },
  { label: "Next phase", detail: "when harvest closes", state: "later" },
] as const;

const outcomeChoices: Array<{ value: HarvestOutcome; title: string; detail: string }> = [
  { value: "harvested", title: "Harvested", detail: "Add today’s cumulative bucket total" },
  { value: "nothing_ready", title: "Nothing ready", detail: "Zero inventory · keep watching" },
  { value: "left_for_later", title: "Left for later", detail: "Zero inventory · intentional choice" },
  { value: "deadheaded", title: "Deadheaded", detail: "Real crop work · zero inventory" },
];

function formatBuckets(bucketHalves: number) {
  const buckets = bucketHalves / 2;
  return Number.isInteger(buckets) ? `${buckets}` : buckets.toFixed(1);
}

export default function HarvestCardSpecimen() {
  const [bucketHalves, setBucketHalves] = useState(0);
  const [outcome, setOutcome] = useState<HarvestOutcome | null>(null);
  const [exhaustedOpen, setExhaustedOpen] = useState(false);
  const stems = bucketHalves * 10;
  const harvestedWithoutQuantity = outcome === "harvested" && bucketHalves === 0;
  const zeroOutcome = outcome === "nothing_ready" || outcome === "left_for_later" || outcome === "deadheaded";

  function chooseOutcome(next: HarvestOutcome) {
    setOutcome(next);
    setExhaustedOpen(false);
    if (next !== "harvested") setBucketHalves(0);
  }

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Harvest</span>
          <small>crop-cycle truth</small>
        </div>
        <h2>White Lite Sunflowers</h2>
        <p>Berry Walk</p>
        <div className={styles.timing}>Morning · harvest window</div>
      </header>

      <div className={styles.trail} aria-label="White Lite sunflower harvest continuity trail">
        {trail.map((step) => (
          <span
            className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater}
            key={`${step.label}-${step.detail}`}
          >
            <b>{step.label}</b>
            <small>{step.detail}</small>
          </span>
        ))}
      </div>

      <section className={styles.cropTruth}>
        <div>
          <span>Crop now</span>
          <strong>Harvestable</strong>
        </div>
        <div className={styles.cropFacts}>
          <b>First petals lifting</b>
          <b>Marketable stems only</b>
          <b>Immediately into water</b>
        </div>
      </section>

      <section className={styles.sharedTruth}>
        <div>
          <span>Harvest board</span>
          <strong>Same crop · same daily total</strong>
        </div>
        <p>
          This task and the persistent Harvest board are two doors into one crop-cycle record. Add more harvest later today and this total keeps growing instead of creating a second Worker-facing tally.
        </p>
      </section>

      <section className={styles.quantity} data-zero-outcome={zeroOutcome ? "true" : "false"}>
        <header>
          <div>
            <span>Today’s harvest</span>
            <small>Cumulative for this bed / crop</small>
          </div>
          <div className={styles.conversion}>½ bucket = 10 stems · 1 bucket = 20 stems</div>
        </header>

        <div className={styles.counter}>
          <button
            type="button"
            aria-label="Remove half a bucket"
            disabled={bucketHalves === 0 || zeroOutcome}
            onClick={() => setBucketHalves((current) => Math.max(0, current - 1))}
          >
            −
          </button>
          <div className={styles.total} aria-live="polite">
            <strong>{formatBuckets(bucketHalves)} {bucketHalves === 2 ? "bucket" : "buckets"}</strong>
            <span>{stems} stems today</span>
          </div>
          <button
            type="button"
            aria-label="Add half a bucket"
            disabled={zeroOutcome}
            onClick={() => {
              setOutcome("harvested");
              setBucketHalves((current) => current + 1);
            }}
          >
            +
          </button>
        </div>

        {zeroOutcome ? <p className={styles.zeroNote}>This result records real crop truth with zero Harvest inventory.</p> : null}
      </section>

      <section className={styles.results}>
        <header>
          <span>What happened?</span>
          <small>Choose the farmer decision, not a generic completion state</small>
        </header>
        <div className={styles.resultGrid}>
          {outcomeChoices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              data-active={outcome === choice.value ? "true" : "false"}
              onClick={() => chooseOutcome(choice.value)}
            >
              <strong>{choice.title}</strong>
              <span>{choice.detail}</span>
            </button>
          ))}
        </div>
        {harvestedWithoutQuantity ? <p className={styles.validation}>Harvested needs at least ½ bucket before it can be finalized.</p> : null}
      </section>

      <details className={styles.observationDrawer}>
        <summary>
          <span>Crop changed?</span>
          <small>Record truth that should change the farm, not a note that follows the task around.</small>
        </summary>
        <div className={styles.observationPanel}>
          <button type="button">Deer damage</button>
          <button type="button">Insect pressure</button>
          <button type="button">Crop damage / loss</button>
          <button type="button">Other meaningful change</button>
          <p>Mock routing: known consequences update crop state automatically; unresolved judgment belongs in the Owner Bell.</p>
        </div>
      </details>

      <details className={styles.backwardLog}>
        <summary>
          <span>Log an earlier harvest</span>
          <small>Backward evidence does not create a second completion.</small>
        </summary>
        <div className={styles.backwardPanel}>
          <label>
            <span>When the harvest actually happened</span>
            <input type="date" />
          </label>
          <p>Atlas keeps the work-completed time, evidence-entry time, and actual farm-event time separate when they differ.</p>
        </div>
      </details>

      <section className={styles.exhaustedSection} data-open={exhaustedOpen ? "true" : "false"}>
        <header>
          <span>Major crop judgment</span>
          <small>Not an ordinary result pill</small>
        </header>
        <button
          type="button"
          className={styles.exhaustedButton}
          aria-expanded={exhaustedOpen}
          onClick={() => {
            setExhaustedOpen((current) => !current);
            setOutcome(null);
            setBucketHalves(0);
          }}
        >
          Mark crop exhausted
        </button>
        {exhaustedOpen ? (
          <div className={styles.exhaustedTruth}>
            <strong>Close this productive Harvest phase</strong>
            <p>For an annual crop, Atlas may now make the appropriate Clear / Turnover / next-crop work eligible. This does not claim the bed is physically clear yet.</p>
            <div>
              <small>Perennial rule</small>
              <span>Seasonal Harvest exhaustion keeps the perennial planting in place and routes to perennial stewardship instead of annual turnover.</span>
            </div>
          </div>
        ) : null}
      </section>

      <footer className={styles.finish}>
        <span>Finish Harvest</span>
        <button type="button" className={styles.primaryFinish} disabled={!outcome || harvestedWithoutQuantity}>
          {outcome === "harvested" && bucketHalves > 0
            ? `Record ${formatBuckets(bucketHalves)} ${bucketHalves === 2 ? "bucket" : "buckets"}`
            : outcome === "nothing_ready"
              ? "Record nothing ready"
              : outcome === "left_for_later"
                ? "Record left for later"
                : outcome === "deadheaded"
                  ? "Record deadheaded"
                  : "Choose what happened"}
        </button>
        <small>Mock only · the production card will write to the same crop-cycle truth used by Harvest.</small>
      </footer>
    </article>
  );
}
