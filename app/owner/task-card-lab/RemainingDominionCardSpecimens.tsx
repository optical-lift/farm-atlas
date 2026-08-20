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

type PlaceFact = {
  label: string;
  value: string;
};

type MovePlace = {
  label: "Source" | "Destination";
  title: string;
  detail: string;
  facts?: PlaceFact[];
  issue: IssueAction;
};

type CropMoveCardProps = {
  family: string;
  familyDetail: string;
  title: string;
  subtitle: string;
  timing: string;
  trailLabel: string;
  trail: TrailStep[];
  source: MovePlace;
  destination: MovePlace;
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
        {action.choices.map((choice) => <button key={choice} type="button">{choice}</button>)}
      </div>
    </details>
  );
}

function PlaceBlock({ place }: { place: MovePlace }) {
  return (
    <div className={styles.movePlace}>
      <div className={styles.placeHeading}>
        <div>
          <small>{place.label}</small>
          <strong>{place.title}</strong>
          <span>{place.detail}</span>
        </div>
        <IssueDrawer action={place.issue} />
      </div>
      {place.facts?.length ? (
        <div className={styles.placeFacts}>
          {place.facts.map((fact) => (
            <div key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong></div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CropMoveCard({
  family,
  familyDetail,
  title,
  subtitle,
  timing,
  trailLabel,
  trail,
  source,
  destination,
}: CropMoveCardProps) {
  return (
    <DominionCardFrame
      family={family}
      familyDetail={familyDetail}
      title={title}
      subtitle={subtitle}
      timing={timing}
    >
      <Trail label={trailLabel} steps={trail} />
      <section className={styles.moveSection}>
        <PlaceBlock place={source} />
        <div className={styles.moveLine} aria-hidden="true">→</div>
        <PlaceBlock place={destination} />
      </section>
    </DominionCardFrame>
  );
}

const transplantTrail: TrailStep[] = [
  { label: "Seeded", detail: "Jul 10", state: "done" },
  { label: "Hardened", detail: "Aug 13", state: "done" },
  { label: "Transplant", detail: "Aug 20", state: "now" },
  { label: "Pinch", detail: "Aug 27", state: "later" },
  { label: "Harvest", detail: "Sep 24", state: "later" },
];

const divideTrail: TrailStep[] = [
  { label: "Planted", detail: "Apr 18, 2025", state: "done" },
  { label: "Established", detail: "May 9, 2025", state: "done" },
  { label: "Divide", detail: "Aug 20", state: "now" },
  { label: "Regrow", detail: "Sep 3", state: "later" },
  { label: "Bloom", detail: "May 2027", state: "later" },
];

export function TransplantCardSpecimen() {
  return (
    <div className={styles.cropMoveSpecimen}>
      <CropMoveCard
        family="Transplant"
        familyDetail="crop move"
        title="Transplant 15 Zinnias"
        subtitle="Curve Garden"
        timing="5 wk 6 d since seeding"
        trailLabel="Zinnia crop lifecycle trail"
        trail={transplantTrail}
        source={{
          label: "Source",
          title: "Grow Room",
          detail: "Zinnia tray · 15 selected",
          facts: [
            { label: "Shelf ID", value: "GR-02" },
            { label: "Tray slot", value: "B3" },
          ],
          issue: { label: "Zinnia tray", choices: ["Count changed", "Damage / loss", "Wrong tray", "Other"] },
        }}
        destination={{
          label: "Destination",
          title: "Curve Garden",
          detail: "Prepared strip",
          issue: { label: "Curve Garden strip", choices: ["Not prepared", "Spacing changed", "Destination problem", "Other"] },
        }}
      />

      <div className={styles.variantLabel}><span>Same crop-move shell · divide variant</span></div>

      <CropMoveCard
        family="Divide"
        familyDetail="crop move"
        title="Divide Shasta Daisies"
        subtitle="Berry Walk"
        timing="2nd season in bed"
        trailLabel="Shasta daisy lifecycle trail"
        trail={divideTrail}
        source={{
          label: "Source",
          title: "Berry Walk · Rail-tie bed 1",
          detail: "Established clump 3",
          facts: [{ label: "Plant", value: "Shasta daisy" }],
          issue: { label: "Shasta daisy clump", choices: ["Root mass issue", "Fewer divisions", "Plant damaged", "Other"] },
        }}
        destination={{
          label: "Destination",
          title: "Berry Walk · Rail-tie bed 2",
          detail: "Open planting space",
          issue: { label: "division destination", choices: ["Not prepared", "Location changed", "Space changed", "Other"] },
        }}
      />
    </div>
  );
}
