"use client";

import { useState } from "react";

import DominionCardFrame from "./DominionCardFrame";
import styles from "./harvest-card-specimen.module.css";

type HarvestOutcome = "nothing_ready" | "deadheaded" | "crop_exhausted";

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
  { value: "nothing_ready", label: "Nothing ready" },
  { value: "deadheaded", label: "Deadheaded" },
  { value: "crop_exhausted", label: "Crop exhausted" },
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
    setBucketHalves(0);
  }

  function changeBucketCount(delta: number) {
    setOutcome(null);
    setBucketHalves((current) => Math.max(0, current + delta));
  }

  return (
    <div className={styles.cropRow} data-open={drawerOpen ? "true" : "false"}>
      <button type="button" className={styles.cropIdentity} aria-expanded={drawerOpen} aria-controls={`harvest-outcomes-${crop.id}`} onClick={() => setDrawerOpen((current) => !current)}>
        <span className={styles.cropText}><strong>{crop.crop}</strong><small>{crop.bed}</small></span>
      </button>

      <div className={styles.bucketCounter} aria-label={`${crop.crop} bucket count`}>
        <button type="button" aria-label={`Remove half bucket from ${crop.crop}`} disabled={bucketHalves === 0} onClick={() => changeBucketCount(-1)}>−</button>
        <strong>{formatBuckets(bucketHalves)}</strong>
        <button type="button" aria-label={`Add half bucket to ${crop.crop}`} onClick={() => changeBucketCount(1)}>+</button>
      </div>

      {drawerOpen ? (
        <div className={styles.exceptionPanel} id={`harvest-outcomes-${crop.id}`}>
          <span>What happened?</span>
          <div className={styles.outcomeGrid}>
            {outcomeChoices.map((choice) => (
              <button type="button" data-active={outcome === choice.value ? "true" : "false"} key={choice.value} onClick={() => chooseOutcome(choice.value)}>{choice.label}</button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function HarvestCardSpecimen() {
  const zones = [...new Set(crops.map((crop) => crop.zone))];

  return (
    <DominionCardFrame family="Harvest" title="Harvest Stems" subtitle={zones.join(" · ")}>
      <div className={styles.trail} aria-label="Harvest season pulse">
        {seasonPulse.map((step) => (
          <span className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater} key={step.label}>
            <b>{step.label}</b><small>{step.detail}</small>
          </span>
        ))}
      </div>

      <div className={styles.harvestList}>
        <div className={styles.listKey}><span>Ready to harvest</span><small>½ bucket · 10 stems</small></div>
        {zones.map((zone) => (
          <section className={styles.zone} key={zone}>
            <header><h3>{zone}</h3></header>
            <div className={styles.zoneRows}>
              {crops.filter((crop) => crop.zone === zone).map((crop) => <CropRow crop={crop} key={crop.id} />)}
            </div>
          </section>
        ))}
      </div>
    </DominionCardFrame>
  );
}
