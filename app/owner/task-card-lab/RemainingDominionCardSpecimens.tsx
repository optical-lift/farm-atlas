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
        <span className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater} key={`${step.label}-${step.detail}`}>
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
        {action.choices.map((choice) => <button key={choice} type="button">{choice}</button>)}
      </div>
    </details>
  );
}

export function TransplantCardSpecimen() {
  const trail: TrailStep[] = [
    { label: "Selected", detail: "15 zinnias", state: "done" },
    { label: "Move", detail: "to field", state: "now" },
    { label: "Establish", detail: "water", state: "later" },
  ];

  return (
    <DominionCardFrame family="Transplant" title="Move 15 Zinnias" subtitle="Curve Garden">
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
