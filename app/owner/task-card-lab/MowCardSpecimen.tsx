import DominionCardFrame from "./DominionCardFrame";
import variantStyles from "./mow-card-variants.module.css";
import styles from "./mow-card-specimen.module.css";

type EquipmentSection = {
  title: string;
  resource: string;
  issues: string[];
};

type MowVariantProps = {
  title: string;
  zone: string;
  previous: string;
  current: string;
  next: string;
  equipment: EquipmentSection;
};

const ridingMower: EquipmentSection = {
  title: "Riding mower",
  resource: "Gas",
  issues: ["Won't start", "Needs gas", "Something broke", "Other"],
};

const pushMower: EquipmentSection = {
  title: "Battery-powered push mower",
  resource: "2 batteries",
  issues: ["Battery problem", "Mower problem", "Battery missing", "Other"],
};

function IssueDrawer({ section }: { section: EquipmentSection }) {
  return (
    <details className={styles.issueDrawer}>
      <summary aria-label={`Log an issue with ${section.title}`} title={`Log an issue with ${section.title}`}>
        <span aria-hidden="true">+</span>
      </summary>
      <div className={styles.issuePanel}>
        <div className={styles.issuePills}>
          {section.issues.map((issue) => <button key={issue} type="button">{issue}</button>)}
        </div>
        <label><span>Note</span><input type="text" placeholder="What happened?" /></label>
      </div>
    </details>
  );
}

function RecurrenceTrail({ title, previous, current, next }: Pick<MowVariantProps, "title" | "previous" | "current" | "next">) {
  return (
    <div className={styles.trail} aria-label={`${title} mowing recurrence trail`}>
      <span className={styles.trailDone}><b>Mowed</b><small>{previous}</small></span>
      <span className={styles.trailNow}><b>Mow</b><small>{current}</small></span>
      <span className={styles.trailNext}><b>Next mow</b><small>{next}</small></span>
    </div>
  );
}

function MowVariant({ title, zone, previous, current, next, equipment }: MowVariantProps) {
  return (
    <DominionCardFrame family="Mow" title={title} subtitle={zone}>
      <RecurrenceTrail title={title} previous={previous} current={current} next={next} />
      <section className={styles.heightSection}><span>Mow height</span><strong>3 in</strong></section>
      <div className={styles.equipmentList}>
        <section className={styles.equipmentSection}>
          <header className={styles.equipmentHeader}><h3>{equipment.title}</h3></header>
          <div className={styles.resourceRow}><strong>{equipment.resource}</strong></div>
          <IssueDrawer section={equipment} />
        </section>
      </div>
    </DominionCardFrame>
  );
}

export default function MowCardSpecimen() {
  return (
    <div className={variantStyles.mowSpecimen}>
      <MowVariant
        title="U-Pick Walkways"
        zone="U-Pick"
        previous="Aug 12"
        current="Aug 19"
        next="Aug 26"
        equipment={ridingMower}
      />
      <div className={variantStyles.variantLabel}><span>Same Mow family · different route, different required resource</span></div>
      <MowVariant
        title="Field Rows Back Half"
        zone="Field Rows"
        previous="Aug 13"
        current="Aug 20"
        next="Aug 27"
        equipment={pushMower}
      />
    </div>
  );
}
