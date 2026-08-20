import DominionCardFrame from "./DominionCardFrame";
import localStyles from "./venue-local-rail.module.css";
import styles from "./venue-card-specimen.module.css";

type VenueResource = { label: string; restockLabel?: string };
type VenueSection = { id: string; title: string; location?: string; resources: VenueResource[] };

const tidySections: VenueSection[] = [
  { id: "entry", title: "Entry", resources: [{ label: "Closet closed" }] },
  { id: "kitchen", title: "Kitchen", resources: [{ label: "Empty trash", restockLabel: "Trash bags" }, { label: "Clean counters" }] },
  { id: "conference-room", title: "Conference room", resources: [{ label: "Tidy chairs" }, { label: "Clean windows" }] },
  { id: "library", title: "Library", resources: [{ label: "Tidy chairs" }, { label: "Beat rug outside" }, { label: "Clean windows" }] },
];

const prepSections: VenueSection[] = [
  { id: "coffee-bar", title: "Coffee bar", location: "Dining room", resources: [{ label: "Keurig" }, { label: "Coffee grounds", restockLabel: "Coffee grounds" }, { label: "Milk", restockLabel: "Milk" }, { label: "Flavored syrup", restockLabel: "Flavored syrup" }, { label: "Mug hutch" }] },
  { id: "water", title: "Water", location: "Dining room", resources: [{ label: "Water dispenser" }, { label: "Clear cups", restockLabel: "Clear cups" }] },
  { id: "blooms", title: "Blooms", location: "For sale at Community Thursday", resources: [{ label: "12 posies" }, { label: "6 bouquets" }] },
];

function RestockDrawer({ label }: { label: string }) {
  return (
    <details className={styles.restockDrawer}>
      <summary aria-label={`Request restock for ${label}`} title={`Request restock for ${label}`}><span aria-hidden="true">+</span></summary>
      <div className={styles.restockPanel}>
        <button type="button">Restock</button>
        <label><span>Note</span><input type="text" placeholder="Add note…" /></label>
      </div>
    </details>
  );
}

function ReminderRow({ resource, id }: { resource: VenueResource; id: string }) {
  return (
    <div className={`${styles.reminderRow} ${localStyles.localReminderRow}`}>
      <input className={styles.reminderToggle} id={id} type="checkbox" />
      <label className={styles.reminderCheck} htmlFor={id}><strong>{resource.label}</strong></label>
      {resource.restockLabel ? <RestockDrawer label={resource.restockLabel} /> : null}
    </div>
  );
}

const trailSteps = ["Tidy", "Prep", "Host", "Reset"] as const;
type TrailStep = (typeof trailSteps)[number];

function EventTrail({ current }: { current: Lowercase<TrailStep> }) {
  const currentIndex = trailSteps.findIndex((step) => step.toLowerCase() === current);
  return (
    <div className={styles.trail} aria-label="Community Thursday task dependency trail">
      {trailSteps.map((step, index) => {
        const stateClass = index < currentIndex ? styles.trailDone : index === currentIndex ? styles.trailNow : styles.trailLocked;
        return <span className={stateClass} key={step}><b>{step}</b><small>Community Thursday</small></span>;
      })}
    </div>
  );
}

function ReminderKey() {
  return <div className={styles.rowKey} aria-label="Venue reminder controls"><span>tap to cross off</span><span><b>+</b> request restock</span></div>;
}

function ReminderSections({ sections, prefix }: { sections: VenueSection[]; prefix: string }) {
  return (
    <div className={styles.stations}>
      {sections.map((section) => (
        <section className={`${styles.station} ${localStyles.localStation}`} key={section.title}>
          <header className={styles.stationHeader}><div><h3>{section.title}</h3>{section.location ? <span>{section.location}</span> : null}</div></header>
          <div className={styles.resourceList}>
            {section.resources.map((resource, index) => <ReminderRow resource={resource} id={`${prefix}-${section.id}-${index}`} key={resource.label} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function TidyCard() {
  return (
    <DominionCardFrame family="Venue" familyDetail="weekly event template" title="Tidy Community Thursday" subtitle="Community Thursday · Elm Farm" timing="Wednesday · whole-space tidy">
      <EventTrail current="tidy" />
      <ReminderKey />
      <ReminderSections sections={tidySections} prefix="tidy" />
    </DominionCardFrame>
  );
}

function PrepCard() {
  return (
    <DominionCardFrame family="Venue" familyDetail="weekly event template" title="Prep Community Thursday" subtitle="Community Thursday · Elm Farm" timing="Wednesday · night-before prep">
      <EventTrail current="prep" />
      <ReminderKey />
      <ReminderSections sections={prepSections} prefix="prep" />
    </DominionCardFrame>
  );
}

function ClassicChecklistRow({ label, id }: { label: string; id: string }) {
  return (
    <label className={styles.classicCheckItem} htmlFor={id}>
      <input id={id} type="checkbox" />
      <span className={styles.classicCircle} aria-hidden="true" />
      <strong>{label}</strong>
    </label>
  );
}

function HostCard() {
  const checklist = ["Turn on the ice maker", "Turn on the OPEN sign", "Open the yellow door"];
  return (
    <DominionCardFrame family="Venue" familyDetail="event opening" title="Host Community Thursday" subtitle="Community Thursday · Elm Farm" timing="Thursday morning · Prep complete" className={styles.hostCard}>
      <EventTrail current="host" />
      <section className={styles.hostChecklist}>
        <header><span>Open the event</span><small>3 steps</small></header>
        <div className={styles.classicChecklist}>
          {checklist.map((item, index) => <ClassicChecklistRow label={item} id={`host-${index}`} key={item} />)}
        </div>
      </section>
    </DominionCardFrame>
  );
}

export default function VenueCardSpecimen() {
  return (
    <div className={styles.venueSpecimen}>
      <TidyCard />
      <div className={styles.nextVariantLabel}><span>Same repeating event · unlocked next</span></div>
      <PrepCard />
      <aside className={styles.templateTruth}>
        <span>Venue grammar · owner-only note</span>
        <p>Community Thursday is one governed repeating event cycle: Tidy → Prep → Host → Reset. Hidden readiness requirements such as mowing being current by the day before the event affect release, but they do not become Worker-facing Trail nodes.</p>
        <p>Every Venue task uses one of only two interaction methods. Instructional / resource cards use titled rooms or stations, each with its own quiet local dot-and-line rail through the things to inspect. Tap-to-cross-off reminders remain memory aids; a + appears only where a restock request makes sense. Execution cards use the shared Atlas checklist for actions that must actually be accomplished.</p>
        <p>Restock requests stay inline beneath the exact resource that raised them; the + remains a compact circular exception affordance. Note inputs use iOS-safe text sizing so opening the keyboard does not zoom the card.</p>
        <p>One-off Venue work does not invent a third card style. Stringing lights can use the checklist method. Painting the doors purple can use the instructional / resource method with Entry room ↔ Library as location context and Purple paint, Drop cloth, Roller, and Brush as the live resources.</p>
      </aside>
      <div className={styles.nextVariantLabel}><span>Same repeating event · unlocked next</span></div>
      <HostCard />
    </div>
  );
}
