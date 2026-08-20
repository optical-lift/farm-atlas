import type { Metadata } from "next";

import HarvestCardSpecimen from "./HarvestCardSpecimen";
import MowCardSpecimen from "./MowCardSpecimen";
import SowCardSpecimen from "./SowCardSpecimen";
import VenueCardSpecimen from "./VenueCardSpecimen";
import WeedCardSpecimen from "./WeedCardSpecimen";
import styles from "./task-card-lab.module.css";

export const metadata: Metadata = {
  title: "Task Card Lab · Atlas",
};

type Resource = {
  label: string;
  kind: string;
  state?: string;
  actions: string[];
};

type Fact = {
  label: string;
  value: string;
};

type CardSpec = {
  family: string;
  variant: string;
  title: string;
  place: string;
  timing: string;
  play: string;
  desiredLabel: string;
  desired: string[];
  facts?: Fact[];
  references?: string[];
  resources?: Resource[];
  finish: string;
  partial?: string;
};

const cards: CardSpec[] = [
  {
    family: "Venue",
    variant: "recurring event cycle",
    title: "Prep Community Thursday",
    place: "Community Thursday · Elm Farm",
    timing: "Wednesday · night-before prep",
    play: "Venue uses its own approved specimen below.",
    desiredLabel: "Venue stations",
    desired: [],
    finish: "Prep complete",
    partial: "Something is not ready",
  },
  {
    family: "Sow",
    variant: "direct sow bed",
    title: "Field Row 6",
    place: "ProCut White Lite · sunflower",
    timing: "Tonight · sowing window open",
    play: "Sow uses its own bed-first specimen below.",
    desiredLabel: "Bed cycle",
    desired: [],
    finish: "Sowing complete",
    partial: "Partly sown",
  },
  {
    family: "Weed",
    variant: "bed care",
    title: "Field Row 13",
    place: "Field Rows · ProCut Orange sunflower",
    timing: "Today · weeding due",
    play: "Weed uses its own bed-history specimen below.",
    desiredLabel: "Bed state",
    desired: [],
    finish: "Done weeding today",
    partial: "Blocked",
  },
  {
    family: "Mow",
    variant: "recurring area care",
    title: "U-Pick Walkways",
    place: "U-Pick",
    timing: "",
    play: "Mow uses its own recurrence-first specimen below.",
    desiredLabel: "Mow height",
    desired: ["3 in"],
    finish: "Mowed to 3 in",
    partial: "Blocked",
  },
  {
    family: "Harvest",
    variant: "repeat cut",
    title: "White Lite Sunflowers",
    place: "Berry Walk",
    timing: "Morning · harvest window",
    play: "Harvest uses its own crop-truth specimen below.",
    desiredLabel: "Harvest standard",
    desired: [],
    finish: "Record harvest",
  },
  {
    family: "Water / Care",
    variant: "establishment water",
    title: "New Zinnia Transplants",
    place: "Curve Garden",
    timing: "Due now · establishment care",
    play: "Deep-water the newly transplanted zinnias until the root zone reaches the defined adequate-moisture condition.",
    desiredLabel: "Enough means",
    desired: ["Root zone evenly moist · no standing runoff · flag plants that wilt again immediately"],
    facts: [
      { label: "Plants", value: "15 zinnias" },
      { label: "Stage", value: "Establishing" },
      { label: "Method", value: "Deep water" },
    ],
    resources: [
      { label: "15 zinnias", kind: "Living crop", state: "Establishing", actions: ["Condition changed", "Damage / loss", "Plant missing", "Request change"] },
      { label: "Water source", kind: "Equipment", state: "Available", actions: ["Problem", "Unavailable", "Working again", "Request change"] },
    ],
    finish: "Care complete",
    partial: "Problem found",
  },
  {
    family: "Check",
    variant: "germination observation",
    title: "Germination Check",
    place: "Barn Bed 4 · white sunflower",
    timing: "Today · observation window",
    play: "Look at the stand and record the smallest observation Atlas needs to decide what can happen next.",
    desiredLabel: "Choose what is true",
    desired: ["Strong", "Patchy", "Failed", "Too early to tell"],
    facts: [
      { label: "Question", value: "Did enough emerge to keep this planting?" },
      { label: "Next", value: "Continue · gap fill · restart · wait" },
    ],
    resources: [
      { label: "Barn Bed 4", kind: "Observed bed", state: "Needs observation", actions: ["Strong", "Patchy", "Failed", "Too early to tell"] },
    ],
    finish: "Record observation",
  },
  {
    family: "Transplant",
    variant: "tray to field",
    title: "Move 15 Zinnias",
    place: "Grow Room → Curve Garden",
    timing: "Today · destination prepared",
    play: "Move the selected zinnias from the source tray into the prepared Curve Garden strip and establish them there.",
    desiredLabel: "Finished move should be",
    desired: ["15 plants in destination · correct spacing · watered immediately"],
    facts: [
      { label: "Count", value: "15" },
      { label: "Source", value: "Grow Room" },
      { label: "Destination", value: "Curve Garden" },
      { label: "Aftercare", value: "Water immediately" },
    ],
    resources: [
      { label: "Zinnia tray", kind: "Living crop", state: "15 selected", actions: ["Count changed", "Damage / loss", "Plants remain", "Request change"] },
      { label: "Curve Garden strip", kind: "Managed place", state: "Prepared", actions: ["Choose a new state", "Something changed", "Add note", "Request change"] },
    ],
    finish: "Transplant complete",
    partial: "Some plants remain",
  },
];

function ResourceDrawer({ resource }: { resource: Resource }) {
  return (
    <details className={styles.resource}>
      <summary>
        <span>
          <strong>{resource.label}</strong>
          <small>{resource.kind}{resource.state ? ` · ${resource.state}` : ""}</small>
        </span>
        <span className={styles.resourceChevron}>+</span>
      </summary>
      <div className={styles.resourceDrawer}>
        <p>What changed?</p>
        <div className={styles.resourceActions}>
          {resource.actions.map((action) => (
            <button key={action} type="button">{action}</button>
          ))}
        </div>
        <label>
          Tell Lex something else
          <textarea rows={2} placeholder="Only what changed or what she needs to know…" />
        </label>
        <button className={styles.noteButton} type="button">Send note</button>
        <small>Mock only · nothing on this page writes to Atlas.</small>
      </div>
    </details>
  );
}

function TaskCard({ card, index }: { card: CardSpec; index: number }) {
  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <div className={styles.familyRow}>
          <span>{card.family}</span>
          <small>{card.variant}</small>
        </div>
        <h2>{card.title}</h2>
        <p>{card.place}</p>
        {card.timing ? <div className={styles.timing}>{card.timing}</div> : null}
      </header>

      <div className={styles.trail} aria-label="Mock process trail">
        <span className={styles.trailDone}>Prior</span>
        <span className={styles.trailDone}>Ready</span>
        <span className={styles.trailNow}>{card.family}</span>
        <span>Next</span>
        <span>Later</span>
      </div>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>The play</span>
        <p className={styles.play}>{card.play}</p>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>{card.desiredLabel}</span>
        <div className={styles.desiredList}>
          {card.desired.map((item) => <div key={item}>{item}</div>)}
        </div>
      </section>

      {card.facts?.length ? (
        <section className={styles.section}>
          <span className={styles.sectionLabel}>Operating facts</span>
          <div className={styles.factGrid}>
            {card.facts.map((fact) => (
              <div key={`${fact.label}-${fact.value}`} className={styles.fact}>
                <small>{fact.label}</small>
                <strong>{fact.value}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {card.references?.length ? (
        <section className={styles.section}>
          <span className={styles.sectionLabel}>Know while doing</span>
          <div className={styles.referenceList}>
            {card.references.map((reference) => <p key={reference}>{reference}</p>)}
          </div>
        </section>
      ) : null}

      {card.resources?.length ? (
        <section className={styles.section}>
          <span className={styles.sectionLabel}>Things in this work</span>
          <p className={styles.tapHint}>Tap a thing when reality changes.</p>
          <div className={styles.resourceList}>
            {card.resources.map((resource) => <ResourceDrawer key={resource.label} resource={resource} />)}
          </div>
        </section>
      ) : null}

      <footer className={styles.finish}>
        <span className={styles.sectionLabel}>Finish this play</span>
        <div className={styles.finishButtons}>
          <button type="button" className={styles.primaryFinish}>{card.finish}</button>
          {card.partial ? <button type="button">{card.partial}</button> : null}
        </div>
        <small>Specimen {index + 1} of {cards.length} · visual lab only</small>
      </footer>
    </article>
  );
}

export default function TaskCardLabPage() {
  return (
    <main className={styles.page}>
      <header className={styles.labHeader}>
        <span>ATLAS · OWNER DESIGN LAB</span>
        <h1>Task Card Gallery</h1>
        <p>
          Every current Dominion family, fully exposed in one vertical scroll. These are fixture-only CSS mockups: no task feed, no scheduling, no Supabase writes.
        </p>
      </header>

      <nav className={styles.jumpNav} aria-label="Jump to task family">
        {cards.map((card, index) => (
          <a key={card.family} href={`#task-card-${index + 1}`}>{card.family}</a>
        ))}
      </nav>

      <div className={styles.gallery}>
        {cards.map((card, index) => (
          <div id={`task-card-${index + 1}`} key={`${card.family}-${card.variant}`} className={styles.cardAnchor}>
            {index === 0
              ? <VenueCardSpecimen />
              : index === 1
                ? <SowCardSpecimen />
                : index === 2
                  ? <WeedCardSpecimen />
                  : index === 3
                    ? <MowCardSpecimen />
                    : index === 4
                      ? <HarvestCardSpecimen />
                      : <TaskCard card={card} index={index} />}
          </div>
        ))}
      </div>
    </main>
  );
}
