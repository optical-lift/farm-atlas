import DominionCardFrame from "./DominionCardFrame";
import styles from "./mow-card-specimen.module.css";

type EquipmentSection = {
  title: string;
  resource: string;
  issues: string[];
};

const equipment: EquipmentSection[] = [
  {
    title: "Riding mower",
    resource: "Gas",
    issues: ["Won't start", "Needs gas", "Something broke", "Other"],
  },
  {
    title: "Battery-powered push mower",
    resource: "2 batteries",
    issues: ["Battery problem", "Mower problem", "Battery missing", "Other"],
  },
];

function IssueDrawer({ section }: { section: EquipmentSection }) {
  return (
    <details className={styles.issueDrawer}>
      <summary aria-label={`Log an issue with ${section.title}`} title={`Log an issue with ${section.title}`}>
        <span aria-hidden="true">+</span>
      </summary>
      <div className={styles.issuePanel}>
        <div className={styles.issuePills}>
          {section.issues.map((issue) => (
            <button key={issue} type="button">{issue}</button>
          ))}
        </div>
        <label>
          <span>Note</span>
          <input type="text" placeholder="What happened?" />
        </label>
      </div>
    </details>
  );
}

function RecurrenceTrail() {
  return (
    <div className={styles.trail} aria-label="U-Pick Walkways mowing recurrence trail">
      <span className={styles.trailDone}>
        <b>Mowed</b>
        <small>Aug 12</small>
      </span>
      <span className={styles.trailNow}>
        <b>Mow</b>
        <small>Aug 19</small>
      </span>
      <span className={styles.trailNext}>
        <b>Next mow</b>
        <small>Aug 26</small>
      </span>
    </div>
  );
}

export default function MowCardSpecimen() {
  return (
    <DominionCardFrame family="Mow" title="U-Pick Walkways">
      <RecurrenceTrail />

      <section className={styles.heightSection}>
        <span>Mow height</span>
        <strong>3 in</strong>
      </section>

      <div className={styles.equipmentList}>
        {equipment.map((section) => (
          <section className={styles.equipmentSection} key={section.title}>
            <header className={styles.equipmentHeader}>
              <h3>{section.title}</h3>
            </header>
            <div className={styles.resourceRow}>
              <strong>{section.resource}</strong>
            </div>
            <IssueDrawer section={section} />
          </section>
        ))}
      </div>
    </DominionCardFrame>
  );
}
