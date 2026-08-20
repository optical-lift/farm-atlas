"use client";

import { useState } from "react";

import DominionCardFrame from "./DominionCardFrame";
import styles from "./remaining-dominion-card-specimens.module.css";

type TrailStep = {
  label: string;
  detail: string;
  state: "done" | "now" | "later";
};

type IssueAction = {
  label: string;
  choices: string[];
};

function Trail({ label, steps }: { label: string; steps: TrailStep[] }) {
  return (
    <div className={styles.trail} aria-label={label}>
      {steps.map((step) => (
        <span
          className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater}
          key={`${step.label}-${step.detail}`}
        >
          <b>{step.label}</b>
          <small>{step.detail}</small>
        </span>
      ))}
    </div>
  );
}

function IssueDrawer({ action }: { action: IssueAction }) {
  return (
    <details className={styles.issueDrawer}>
      <summary aria-label={`Log an issue with ${action.label}`} title={`Log an issue with ${action.label}`}>
        <span aria-hidden="true">+</span>
      </summary>
      <div className={styles.issuePanel}>
        {action.choices.map((choice) => (
          <button key={choice} type="button">{choice}</button>
        ))}
      </div>
    </details>
  );
}

export function WaterCareCardSpecimen() {
  const trail: TrailStep[] = [
    { label: "Moved", detail: "15 zinnias", state: "done" },
    { label: "Establish", detail: "care now", state: "now" },
    { label: "Next check", detail: "crop response", state: "later" },
  ];

  return (
    <DominionCardFrame family="Water / Care" title="New Zinnia Transplants">
      <Trail label="Zinnia establishment care trail" steps={trail} />

      <section className={styles.contextStrip}>
        <div>
          <span>Curve Garden</span>
          <strong>15 zinnias</strong>
        </div>
        <b>Establishing</b>
      </section>

      <section className={styles.factSection}>
        <div>
          <small>Method</small>
          <strong>Deep water</strong>
        </div>
        <div>
          <small>Enough</small>
          <strong>Evenly moist</strong>
          <span>No standing runoff</span>
        </div>
      </section>

      <section className={styles.resourceSection}>
        <header><span>Living crop</span></header>
        <div className={styles.resourceRow}>
          <div>
            <strong>15 zinnias</strong>
            <small>Establishing</small>
          </div>
          <IssueDrawer action={{ label: "15 zinnias", choices: ["Condition changed", "Damage / loss", "Plant missing"] }} />
        </div>
      </section>

      <section className={styles.resourceSection}>
        <header><span>Water source</span></header>
        <div className={styles.resourceRow}>
          <div>
            <strong>Available</strong>
          </div>
          <IssueDrawer action={{ label: "water source", choices: ["Problem", "Unavailable", "Working again"] }} />
        </div>
      </section>
    </DominionCardFrame>
  );
}

type CheckChoice = "Strong" | "Patchy" | "Failed" | "Too early to tell";

const checkNext: Record<CheckChoice, string> = {
  Strong: "Continue",
  Patchy: "Gap fill",
  Failed: "Restart",
  "Too early to tell": "Wait",
};

export function CheckCardSpecimen() {
  const [choice, setChoice] = useState<CheckChoice | null>(null);
  const trail: TrailStep[] = [
    { label: "Sown", detail: "white sunflower", state: "done" },
    { label: "Check", detail: "germination", state: "now" },
    { label: "Next move", detail: choice ? checkNext[choice] : "from result", state: "later" },
  ];

  return (
    <DominionCardFrame family="Check" title="Germination Check">
      <Trail label="Barn Bed 4 germination decision trail" steps={trail} />

      <section className={styles.contextStrip}>
        <div>
          <span>Barn Bed 4</span>
          <strong>White sunflower</strong>
        </div>
        <b>Observation</b>
      </section>

      <section className={styles.checkSection}>
        <header>
          <span>Did enough emerge to keep this planting?</span>
        </header>
        <div className={styles.checkChoices}>
          {(Object.keys(checkNext) as CheckChoice[]).map((item) => (
            <button
              type="button"
              data-active={choice === item ? "true" : "false"}
              key={item}
              onClick={() => setChoice(item)}
            >
              {item}
            </button>
          ))}
        </div>
        {choice ? (
          <div className={styles.nextMove}>
            <small>Next</small>
            <strong>{checkNext[choice]}</strong>
          </div>
        ) : null}
      </section>
    </DominionCardFrame>
  );
}

export function TransplantCardSpecimen() {
  const trail: TrailStep[] = [
    { label: "Selected", detail: "15 zinnias", state: "done" },
    { label: "Move", detail: "to field", state: "now" },
    { label: "Establish", detail: "water", state: "later" },
  ];

  return (
    <DominionCardFrame family="Transplant" title="Move 15 Zinnias">
      <Trail label="Zinnia source to destination trail" steps={trail} />

      <section className={styles.moveSection}>
        <div className={styles.movePlace}>
          <small>Source</small>
          <strong>Grow Room</strong>
          <span>Zinnia tray · 15 selected</span>
          <IssueDrawer action={{ label: "Zinnia tray", choices: ["Count changed", "Damage / loss", "Plants remain"] }} />
        </div>
        <div className={styles.moveLine} aria-hidden="true">→</div>
        <div className={styles.movePlace}>
          <small>Destination</small>
          <strong>Curve Garden</strong>
          <span>Prepared strip</span>
          <IssueDrawer action={{ label: "Curve Garden strip", choices: ["Something changed", "Not prepared", "Destination problem"] }} />
        </div>
      </section>

      <section className={styles.aftercare}>
        <small>Aftercare</small>
        <strong>Water immediately</strong>
      </section>
    </DominionCardFrame>
  );
}
