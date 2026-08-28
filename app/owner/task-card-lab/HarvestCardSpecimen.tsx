"use client";

import { useMemo, useState } from "react";

import DominionCardFrame from "./DominionCardFrame";
import styles from "./harvest-card-specimen.module.css";

type HarvestOutcome = "nothing_ready" | "deadheaded" | "crop_exhausted";
type IntakeSource = "Foraged" | "Garden" | "Purchased" | "Gifted";
type IntakeUnit = "Stems" | "Buckets" | "Bunches";
type IntakeExactness = "Exact" | "Approx" | "Unknown";
type IntakeCondition = "FQ" | "SP" | "Mixed" | "Unknown";

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

const sourceChoices: IntakeSource[] = ["Foraged", "Garden", "Purchased", "Gifted"];
const contentChoices = ["Zinnias", "Marigolds", "Sunflowers", "Celosia", "Foliage", "Mixed", "Unknown"] as const;
const unitChoices: IntakeUnit[] = ["Stems", "Buckets", "Bunches"];
const exactnessChoices: IntakeExactness[] = ["Exact", "Approx", "Unknown"];
const conditionChoices: IntakeCondition[] = ["FQ", "SP", "Mixed", "Unknown"];

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

function ExternalIntakeBuilder({ onClose }: { onClose: () => void }) {
  const [sourceType, setSourceType] = useState<IntakeSource>("Garden");
  const [sourceLabel, setSourceLabel] = useState("Mary’s garden");
  const [contents, setContents] = useState<string[]>(["Zinnias", "Marigolds"]);
  const [unit, setUnit] = useState<IntakeUnit>("Buckets");
  const [quantity, setQuantity] = useState(2);
  const [stemExactness, setStemExactness] = useState<IntakeExactness>("Unknown");
  const [stemCount, setStemCount] = useState(0);
  const [condition, setCondition] = useState<IntakeCondition>("Mixed");
  const [saved, setSaved] = useState(false);

  function toggleContent(value: string) {
    setContents((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  const contentLabel = contents.length ? contents.join(" + ") : "contents unknown";
  const stemLabel = unit === "Stems"
    ? `${stemExactness === "Approx" ? "~" : ""}${quantity} stems${stemExactness === "Unknown" ? " · count uncertain" : ""}`
    : stemExactness === "Unknown"
      ? "stem count unknown"
      : `${stemExactness === "Approx" ? "~" : ""}${stemCount} stems`;

  const sentence = useMemo(
    () => [sourceType, sourceLabel.trim() || "source unknown", `${quantity} ${unit.toLowerCase()}`, contentLabel, stemLabel, `${condition.toLowerCase()} condition`].join(" · "),
    [sourceType, sourceLabel, quantity, unit, contentLabel, stemLabel, condition],
  );

  return (
    <section className={styles.externalDrawer} aria-label="External flower intake builder">
      <div className={styles.externalDrawerHead}>
        <div><span>External intake</span><strong>Add flowers that did not come from an Elm bed</strong></div>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      {saved ? (
        <div className={styles.savedIntake}>
          <span>Added to today’s flower custody</span>
          <strong>{sentence}</strong>
          <button type="button" onClick={() => setSaved(false)}>Edit</button>
        </div>
      ) : (
        <div className={styles.externalBuilder}>
          <div className={styles.intakeSentence}>{sentence}</div>

          <div className={styles.intakeStep}>
            <span>How did these come in?</span>
            <div className={styles.intakePills}>
              {sourceChoices.map((choice) => <button type="button" data-active={sourceType === choice ? "true" : "false"} key={choice} onClick={() => setSourceType(choice)}>{choice}</button>)}
            </div>
          </div>

          <label className={styles.intakeTextField}>
            <span>Source / place</span>
            <input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="Roadside, Mary’s garden, wholesaler…" />
          </label>

          <div className={styles.intakeStep}>
            <span>What came in?</span>
            <div className={styles.intakePills}>
              {contentChoices.map((choice) => <button type="button" data-active={contents.includes(choice) ? "true" : "false"} key={choice} onClick={() => toggleContent(choice)}>{choice}</button>)}
            </div>
          </div>

          <div className={styles.intakeStep}>
            <span>Count as</span>
            <div className={styles.intakePills}>
              {unitChoices.map((choice) => <button type="button" data-active={unit === choice ? "true" : "false"} key={choice} onClick={() => setUnit(choice)}>{choice}</button>)}
            </div>
            <div className={styles.intakeCounterRow}>
              <button type="button" disabled={quantity === 0} onClick={() => setQuantity((current) => Math.max(0, current - 1))}>−</button>
              <strong>{quantity}</strong>
              <button type="button" onClick={() => setQuantity((current) => current + 1)}>+</button>
              <small>{unit.toLowerCase()}</small>
            </div>
          </div>

          <div className={styles.intakeStep}>
            <span>Stem count</span>
            <div className={styles.intakePills}>
              {exactnessChoices.map((choice) => <button type="button" data-active={stemExactness === choice ? "true" : "false"} key={choice} onClick={() => setStemExactness(choice)}>{choice}</button>)}
            </div>
            {unit !== "Stems" && stemExactness !== "Unknown" ? (
              <div className={styles.intakeCounterRow}>
                <button type="button" disabled={stemCount === 0} onClick={() => setStemCount((current) => Math.max(0, current - 1))}>−</button>
                <strong>{stemCount}</strong>
                <button type="button" onClick={() => setStemCount((current) => current + 1)}>+</button>
                <small>stems</small>
              </div>
            ) : null}
          </div>

          <div className={styles.intakeStep}>
            <span>Condition</span>
            <div className={styles.intakePills}>
              {conditionChoices.map((choice) => <button type="button" data-active={condition === choice ? "true" : "false"} key={choice} onClick={() => setCondition(choice)}>{choice}</button>)}
            </div>
          </div>

          <button type="button" className={styles.saveIntakeButton} onClick={() => setSaved(true)}>Add to harvest custody</button>
        </div>
      )}
    </section>
  );
}

export default function HarvestCardSpecimen() {
  const zones = [...new Set(crops.map((crop) => crop.zone))];
  const [externalOpen, setExternalOpen] = useState(false);

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

      <div className={styles.externalIntakeLaunch}>
        <div><span>Additional flowers</span><strong>Foraged, gifted, garden-cut, or purchased</strong></div>
        <button type="button" aria-expanded={externalOpen} onClick={() => setExternalOpen((current) => !current)}>External intake</button>
      </div>

      {externalOpen ? <ExternalIntakeBuilder onClose={() => setExternalOpen(false)} /> : null}
    </DominionCardFrame>
  );
}
