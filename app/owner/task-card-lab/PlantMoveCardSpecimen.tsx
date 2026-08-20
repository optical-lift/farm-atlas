"use client";

import { useState } from "react";

import bedStyles from "./weed-card-specimen.module.css";
import styles from "./plant-move-card-specimen.module.css";

type TrailStep = {
  label: string;
  detail: string;
  state: "done" | "now" | "later";
};

type Placement = {
  label: string;
  occupied?: boolean;
  planned?: boolean;
};

const transplantTrail: TrailStep[] = [
  { label: "Prepared", detail: "Aug 18", state: "done" },
  { label: "Transplant", detail: "today", state: "now" },
  { label: "Water", detail: "after planting", state: "later" },
  { label: "Pinch", detail: "when ready", state: "later" },
  { label: "Harvest", detail: "later", state: "later" },
];

const divideTrail: TrailStep[] = [
  { label: "Established", detail: "existing iris", state: "done" },
  { label: "Divide + plant", detail: "today", state: "now" },
  { label: "Water", detail: "after planting", state: "later" },
  { label: "Establish", detail: "next check", state: "later" },
  { label: "Divide", detail: "future", state: "later" },
];

function Trail({ steps, label }: { steps: TrailStep[]; label: string }) {
  return (
    <div className={bedStyles.trail} aria-label={label}>
      {steps.map((step) => (
        <span
          className={step.state === "done" ? bedStyles.trailDone : step.state === "now" ? bedStyles.trailNow : bedStyles.trailLater}
          key={`${step.label}-${step.detail}`}
        >
          <b>{step.label}</b>
          <small>{step.detail}</small>
        </span>
      ))}
    </div>
  );
}

function PlacementMap({ label, placements }: { label: string; placements: Placement[] }) {
  const [selected, setSelected] = useState(0);
  return (
    <section className={styles.placementSection}>
      <header>
        <span>Placement</span>
        <small>destination preview</small>
      </header>
      <div className={styles.placementMap} aria-label={label}>
        {placements.map((placement, index) => (
          <button
            type="button"
            className={`${styles.placementCell} ${placement.occupied ? styles.occupied : ""} ${placement.planned ? styles.planned : ""} ${selected === index ? styles.selected : ""}`}
            onClick={() => setSelected(index)}
            key={`${placement.label}-${index}`}
          >
            <span>{placement.occupied ? "o" : placement.planned ? "+" : "·"}</span>
          </button>
        ))}
      </div>
      <div className={styles.placementDetail}>
        <span>{placements[selected]?.label ?? "Placement"}</span>
        <strong>{placements[selected]?.occupied ? "Existing planting" : placements[selected]?.planned ? "Plant here" : "Open bed space"}</strong>
      </div>
      <div className={styles.legend}><span><b>o</b> existing</span><span><b>+</b> new placement</span></div>
    </section>
  );
}

function SurpriseRow({ name, options }: { name: string; options: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <section className={styles.surprises}>
      <header><span>Surprises</span></header>
      <div>
        {options.map((option) => (
          <button
            type="button"
            className={selected === option ? styles.selectedSurprise : undefined}
            onClick={() => setSelected(option)}
            key={option}
          >{option}</button>
        ))}
        <details>
          <summary>Log it</summary>
          <div><input type="text" placeholder="What changed?" aria-label={`${name} note`} /><button type="button">Save</button></div>
        </details>
      </div>
    </section>
  );
}

function MoveBlock({ action, crop, source, destination, count }: { action: string; crop: string; source: string; destination: string; count: string }) {
  return (
    <section className={styles.moveBlock}>
      <span>{action}</span>
      <strong>{count} · {crop}</strong>
      <div><b>{source}</b><i>→</i><b>{destination}</b></div>
    </section>
  );
}

function FactRow({ facts }: { facts: { label: string; value: string }[] }) {
  return (
    <section className={styles.facts}>
      {facts.map((fact) => <div key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong></div>)}
    </section>
  );
}

function TransplantCard() {
  const placements: Placement[] = Array.from({ length: 18 }, (_, index) => ({
    label: `Position ${index + 1}`,
    planned: index < 15,
  }));

  return (
    <article className={bedStyles.card}>
      <header className={bedStyles.header}>
        <div className={bedStyles.familyRow}><span>Transplant</span><small>plant / move</small></div>
        <h2>Curve Garden Bed 3</h2>
        <p>Curve Garden</p>
      </header>

      <Trail steps={transplantTrail} label="Curve Garden Bed 3 crop Trail" />

      <MoveBlock action="Moving here" crop="Benary’s Giant White zinnia" count="15 plants" source="Grow Room · tray" destination="Curve Garden Bed 3" />

      <FactRow facts={[{ label: "Count", value: "15" }, { label: "Spacing", value: "9 in" }, { label: "Rows", value: "3" }]} />

      <PlacementMap label="Planned zinnia placement in Curve Garden Bed 3" placements={placements} />

      <SurpriseRow name="transplant" options={["Fewer plants", "Rootbound", "Plant loss", "Destination differs"]} />

      <footer className={bedStyles.finish}>
        <span>Finish Transplant</span>
        <div><button type="button" className={bedStyles.primaryFinish}>Plants are in the bed</button><button type="button">Blocked</button></div>
      </footer>
    </article>
  );
}

function DividePlantCard() {
  const placements: Placement[] = Array.from({ length: 20 }, (_, index) => ({
    label: `Drift position ${index + 1}`,
    occupied: index === 1 || index === 8 || index === 15,
    planned: [2, 3, 4, 7, 9, 10, 14, 16, 17].includes(index),
  }));

  return (
    <article className={bedStyles.card}>
      <header className={bedStyles.header}>
        <div className={bedStyles.familyRow}><span>Divide + plant</span><small>plant / move</small></div>
        <h2>Lilac Haven</h2>
        <p>Fence line planting</p>
      </header>

      <Trail steps={divideTrail} label="Lilac Haven iris life and stewardship Trail" />

      <MoveBlock action="Take from / plant into" crop="Iris" count="3 source clumps" source="Existing fence-line clumps" destination="New drift placements" />

      <section className={styles.divideYield}>
        <span>Division creates the quantity</span>
        <strong>Record actual divisions established</strong>
        <input type="number" min="0" placeholder="0" aria-label="Actual iris divisions established" />
      </section>

      <PlacementMap label="Existing and planned iris drift placements" placements={placements} />

      <SurpriseRow name="divide-plant" options={["Fewer divisions", "Rot / damage", "Roots dry", "Placement differs"]} />

      <footer className={bedStyles.finish}>
        <span>Finish Divide + Plant</span>
        <div><button type="button" className={bedStyles.primaryFinish}>Divisions are established</button><button type="button">Blocked</button></div>
      </footer>
    </article>
  );
}

export default function PlantMoveCardSpecimen() {
  return (
    <div className={styles.stack}>
      <TransplantCard />
      <div className={styles.variantLabel}><span>Same movement grammar · source plant becomes multiple placements</span></div>
      <DividePlantCard />
    </div>
  );
}
