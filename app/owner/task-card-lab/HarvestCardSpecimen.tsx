"use client";

import { useState } from "react";

import styles from "./harvest-card-specimen.module.css";

type HarvestOutcome = "harvested" | "nothing_ready" | "left_for_later" | "deadheaded";

type HarvestCrop = {
  id: string;
  zone: string;
  bed: string;
  crop: string;
};

const seasonPulse = [
  { label: "Last round", detail: "6 crops · 7½ buckets", state: "done" },
  { label: "This round", detail: "4 crops ready", state: "now" },
  { label: "Next watch", detail: "3 crops", state: "later" },
] as const;

const crops: HarvestCrop[] = [
  { id: "bw5-white-lite", zone: "Berry Walk", bed: "BW5", crop: "White Lite sunflower" },
  { id: "bw7-italian-white", zone: "Berry Walk", bed: "BW7", crop: "Italian White sunflower" },
  { id: "fr2-zinnia", zone: "Field Rows", bed: "FR2", crop: "Zinnia mix" },
  { id: "fr15-italian-white", zone: "Field Rows", bed: "FR15", crop: "Italian White sunflower" },
];

const outcomeChoices: Array<{ value: HarvestOutcome; label: string }> = [
  { value: "harvested", label: "Harvested" },
  { value: "nothing_ready", label: "Nothing ready" },
  { value: "left_for_later", label: "Left for later" },
  { value: "deadheaded", label: "Deadheaded" },
];

function formatBuckets(bucketHalves: number) {
  const buckets = bucketHalves / 2;
  return Number.isInteger(buckets) ? `${buckets}` : `${Math.floor(buckets)}½`.replace("0½", "½");
}

function CropRow({ crop }: { crop: HarvestCrop }) {
  const [bucketHalves, setBucketHalves] = useState(0);
  const [outcome, setOutcome] = useState<HarvestOutcome | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function chooseOutcome(next: HarvestOutcome) {
    setOutcome(next);
    if (next !== "harvested") setBucketHalves(0);
  }

  return (
    <div className={styles.cropRow} data-open={drawerOpen ? "true" : "false"}>
      <button
        type="button"
        className={styles.cropIdentity}
        aria-expanded={drawerOpen}
        aria-controls={`harvest-outcomes-${crop.id}`}
        onClick={() => setDrawerOpen((current) => !current)}
      >
        <span className={styles.cropText}>
          <strong>{crop.crop}</strong>
          <small>{crop.bed}</small>
        </span>
        <span className={styles.drawerCue} aria-hidden="true">⌄</span>
      </button>

      <div className={styles.bucketCounter} aria-label={`${crop.crop} bucket count`}>
        <button
          type="button"
          aria-label={`Remove half bucket from ${crop.crop}`}
          disabled={bucketHalves === 0}
          onClick={() => {
            setOutcome("harvested");
            setBucketHalves((current) => Math.max(0, current - 1));
          }}
        >
          −½
        </button>
        <strong>{formatBuckets(bucketHalves)}</strong>
        <button
          type="button"
          aria-label={`Add half bucket to ${crop.crop}`}
          onClick={() => {
            setOutcome("harvested");
            setBucketHalves((current) => current + 1);
          }}
        >
          +½
        </button>
      </div>

      {drawerOpen ? (
        <div className={styles.exceptionPanel} id={`harvest-outcomes-${crop.id}`}>
          <span>What happened?</span>
          <div className={styles.outcomeGrid}>
            {outcomeChoices.map((choice) => (
              <button
                type="button"
                data-active={outcome === choice.value ? "true" : "false"}
                key={choice.value}
                onClick={() => chooseOutcome(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <button type="button" className={styles.exhaustedAction}>Crop exhausted</button>
        </div>
      ) : null}
    </div>
  );
}

export default function HarvestCardSpecimen() {
  const zones = [...new Set(crops.map((crop) => crop.zone))];

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <h2>Harvest Stems</h2>
      </header>

      <div className={styles.trail} aria-label="Harvest season pulse">
        {seasonPulse.map((step) => (
          <span
            className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater}
            key={step.label}
          >
            <b>{step.label}</b>
            <small>{step.detail}</small>
          </span>
        ))}
      </div>

      <div className={styles.harvestList}>
        <div className={styles.listKey}>
          <span>Ready to harvest</span>
          <small>½ bucket · 10 stems</small>
        </div>

        {zones.map((zone) => (
          <section className={styles.zone} key={zone}>
            <header><h3>{zone}</h3></header>
            <div className={styles.zoneRows}>
              {crops.filter((crop) => crop.zone === zone).map((crop) => (
                <CropRow crop={crop} key={crop.id} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className={styles.finish}>
        <button type="button" className={styles.primaryFinish}>Done</button>
        <button type="button" className={styles.secondaryFinish}>Unfinished</button>
      </footer>
    </article>
  );
}
