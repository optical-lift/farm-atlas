import styles from "./venue-card-specimen.module.css";

type VenueResource = {
  label: string;
  restockLabel?: string;
};

type VenueSection = {
  id: string;
  title: string;
  location?: string;
  resources: VenueResource[];
};

const tidySections: VenueSection[] = [
  {
    id: "library",
    title: "Library",
    resources: [
      { label: "Tidy chairs" },
      { label: "Beat rug outside" },
      { label: "Clean windows" },
    ],
  },
  {
    id: "conference-room",
    title: "Conference room",
    resources: [
      { label: "Tidy chairs" },
      { label: "Clean windows" },
    ],
  },
  {
    id: "kitchen",
    title: "Kitchen",
    resources: [
      { label: "Empty trash", restockLabel: "Trash bags" },
      { label: "Clean counters" },
    ],
  },
];

const prepSections: VenueSection[] = [
  {
    id: "coffee-bar",
    title: "Coffee bar",
    location: "Dining room",
    resources: [
      { label: "Keurig" },
      { label: "Coffee grounds", restockLabel: "Coffee grounds" },
      { label: "Milk", restockLabel: "Milk" },
      { label: "Flavored syrup", restockLabel: "Flavored syrup" },
      { label: "Mug hutch" },
    ],
  },
  {
    id: "water",
    title: "Water",
    location: "Dining room",
    resources: [
      { label: "Water dispenser" },
      { label: "Clear cups", restockLabel: "Clear cups" },
    ],
  },
  {
    id: "blooms",
    title: "Blooms",
    location: "For sale at Community Thursday",
    resources: [
      { label: "12 posies" },
      { label: "6 bouquets" },
    ],
  },
];

function RestockDrawer({ label }: { label: string }) {
  return (
    <details className={styles.restockDrawer}>
      <summary aria-label={`Request restock for ${label}`} title={`Request restock for ${label}`}>
        <span aria-hidden="true">+</span>
      </summary>
      <div className={styles.restockPanel}>
        <button type="button">Restock</button>
        <label>
          <span>Note</span>
          <input type="text" placeholder="Add note…" />
        </label>
      </div>
    </details>
  );
}

function ReminderRow({ resource, id }: { resource: VenueResource; id: string }) {
  return (
    <div className={styles.reminderRow}>
      <input className={styles.reminderToggle} id={id} type="checkbox" />
      <label className={styles.reminderCheck} htmlFor={id}>
        <strong>{resource.label}</strong>
      </label>
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
        const stateClass = index < currentIndex
          ? styles.trailDone
          : index === currentIndex
            ? styles.trailNow
            : styles.trailLocked;

        return (
          <span className={stateClass} key={step}>
            <b>{step}</b>
            <small>Community Thursday</small>
          </span>
        );
      })}
    </div>
  );
}

function ReminderKey() {
  return (
    <div className={styles.rowKey} aria-label="Venue reminder controls">
      <span>tap to cross off</span>
      <span><b>+</b> request restock</span>
    </div>
  );
}

function ReminderSections({ sections, prefix }: { sections: VenueSection[]; prefix: string }) {
  return (
    <div className={styles.stations}>
      {sections.map((section) => (
        <section className={styles.station} key={section.title}>
          <header className={styles.stationHeader}>
            <div>
              <h3>{section.title}</h3>
              {section.location ? <span>{section.location}</span> : null}
            </div>
          </header>
          <div className={styles.resourceList}>
            {section.resources.map((resource, index) => (
              <ReminderRow
                resource={resource}
                id={`${prefix}-${section.id}-${index}`}
                key={resource.label}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TidyCard() {
  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Venue</span>
          <small>weekly event template</small>
        </div>
        <h2>Tidy Community Thursday</h2>
        <p>Community Thursday · Elm Farm</p>
        <div className={styles.timing}>Wednesday · whole-space tidy</div>
      </header>

      <EventTrail current="tidy" />
      <ReminderKey />
      <ReminderSections sections={tidySections} prefix="tidy" />

      <footer className={styles.finish}>
        <span>Finish Tidy</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Tidy complete</button>
          <button type="button">Something remains</button>
        </div>
        <small>The crossed-off rows are memory aids, not completion gates. Finishing Tidy unlocks Prep.</small>
      </footer>
    </article>
  );
}

function PrepCard() {
  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Venue</span>
          <small>weekly event template</small>
        </div>
        <h2>Prep Community Thursday</h2>
        <p>Community Thursday · Elm Farm</p>
        <div className={styles.timing}>Wednesday · night-before prep</div>
      </header>

      <EventTrail current="prep" />
      <ReminderKey />
      <ReminderSections sections={prepSections} prefix="prep" />

      <footer className={styles.finish}>
        <span>Finish Prep</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Prep complete</button>
          <button type="button">Something is not ready</button>
        </div>
        <small>The crossed-off rows are memory aids, not completion gates. Finishing Prep unlocks Host.</small>
      </footer>
    </article>
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
  const checklist = [
    "Turn on the ice maker",
    "Turn on the OPEN sign",
    "Open the yellow door",
  ];

  return (
    <article className={`${styles.card} ${styles.hostCard}`}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Venue</span>
          <small>event opening</small>
        </div>
        <h2>Host Community Thursday</h2>
        <p>Community Thursday · Elm Farm</p>
        <div className={styles.timing}>Thursday morning · Prep complete</div>
      </header>

      <EventTrail current="host" />

      <section className={styles.hostChecklist}>
        <header>
          <span>Open the event</span>
          <small>3 steps</small>
        </header>
        <div className={styles.classicChecklist}>
          {checklist.map((item, index) => (
            <ClassicChecklistRow label={item} id={`host-${index}`} key={item} />
          ))}
        </div>
      </section>

      <footer className={styles.finish}>
        <span>Finish Host</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Event open</button>
          <button type="button">Blocked</button>
        </div>
        <small>Host is a true execution checklist, so its steps use the shared Atlas checklist grammar.</small>
      </footer>
    </article>
  );
}

export default function VenueCardSpecimen() {
  return (
    <div className={styles.venueSpecimen}>
      <TidyCard />

      <div className={styles.nextVariantLabel}>
        <span>Same repeating event · unlocked next</span>
      </div>

      <PrepCard />

      <aside className={styles.templateTruth}>
        <span>Venue grammar · owner-only note</span>
        <p>
          Community Thursday is one governed repeating event cycle: Tidy → Prep → Host → Reset. Hidden readiness requirements such as mowing being current by the day before the event affect release, but they do not become Worker-facing Trail nodes.
        </p>
        <p>
          Every Venue task uses one of only two interaction methods. Instructional / resource cards use titled rooms or stations with tap-to-cross-off reminders and a + only where a restock request makes sense. Execution cards use the shared Atlas checklist for actions that must actually be accomplished.
        </p>
        <p>
          One-off Venue work does not invent a third card style. Stringing lights can use the checklist method. Painting the doors purple can use the instructional / resource method with Entry room ↔ Library as location context and Purple paint, Drop cloth, Roller, and Brush as the live resources.
        </p>
      </aside>

      <div className={styles.nextVariantLabel}>
        <span>Same repeating event · unlocked next</span>
      </div>

      <HostCard />
    </div>
  );
}
